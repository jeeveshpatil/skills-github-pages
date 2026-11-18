import { describe, expect, it } from 'vitest';
import { bearing, distance, formatClock, formatDistance, nextShrinkAt, zoneRadiusAt } from './geo';
import { canTag, isPrey } from './modes';
import { rankFor } from './ranks';

const base = { status: 'active' as const, paused_at: null, zone_start_m: 1000, zone_end_m: 200, zone_steps: 4 };
const t0 = Date.parse('2026-01-01T00:00:00Z');
const room = { ...base, headstart_ends_at: new Date(t0).toISOString(), ends_at: new Date(t0 + 4000_000).toISOString() };

describe('geo', () => {
  it('haversine matches known distance (~111 km per degree latitude)', () => {
    expect(distance(0, 0, 1, 0)).toBeGreaterThan(111000);
    expect(distance(0, 0, 1, 0)).toBeLessThan(111400);
    expect(distance(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });
  it('bearing is clockwise from north', () => {
    expect(Math.round(bearing(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearing(0, 0, 0, 1))).toBe(90);
    expect(Math.round(bearing(0, 0, -1, 0))).toBe(180);
  });
  it('zone shrinks stepwise like the SQL implementation', () => {
    expect(zoneRadiusAt(room, t0 - 1000)).toBe(1000);
    expect(zoneRadiusAt(room, t0 + 999_000)).toBe(1000);
    expect(zoneRadiusAt(room, t0 + 1000_000)).toBe(800);
    expect(zoneRadiusAt(room, t0 + 4000_000)).toBe(200);
    expect(zoneRadiusAt({ ...room, zone_steps: 0 }, t0 + 2000_000)).toBe(600);
  });
  it('zone freezes while paused', () => {
    const paused = { ...room, status: 'paused' as const, paused_at: new Date(t0 + 500_000).toISOString() };
    expect(zoneRadiusAt(paused, t0 + 3_900_000)).toBe(1000);
  });
  it('next shrink time', () => {
    expect(nextShrinkAt(room, t0 + 10)).toBe(t0 + 1000_000);
    expect(nextShrinkAt(room, t0 + 3_500_000)).toBeNull();
  });
  it('formats', () => {
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatDistance(950)).toBe('950 m');
    expect(formatDistance(1500)).toBe('1.5 km');
  });
});

describe('modes', () => {
  it('tag matrix', () => {
    expect(canTag('classic', 'hunter', 'shadow')).toBe(true);
    expect(canTag('classic', 'shadow', 'hunter')).toBe(false);
    expect(canTag('team_vs_team', 'red', 'blue')).toBe(true);
    expect(canTag('team_vs_team', 'red', 'red')).toBe(false);
    expect(isPrey('team_vs_team', 'blue')).toBe(true);
    expect(isPrey('infection', 'hunter')).toBe(false);
  });
});

describe('ranks', () => {
  it('progression', () => {
    expect(rankFor(0).name).toBe('Recruit');
    expect(rankFor(850).name).toBe('Tracker');
    expect(rankFor(999999).next).toBeNull();
  });
});
