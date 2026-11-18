import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom';
import { useAuth } from '../hooks/useAuth';
import { useGameLoop } from '../hooks/useGameLoop';
import { Button, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import Lobby from './room/Lobby';
import Game from './room/Game';
import Results from './room/Results';

export default function RoomPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const state = useRoom(id);
  const uid = session!.user.id;
  const me = state.players.find((p) => p.user_id === uid);
  const loop = useGameLoop(state.room, me);

  // kicked: we were a member, now we're not
  const wasMember = useRef(false);
  useEffect(() => {
    if (me) wasMember.current = true;
    else if (wasMember.current && !state.loading && state.room?.status !== 'ended') {
      toast('You were removed from the room', 'warn');
      nav('/', { replace: true });
    }
  }, [me, state.loading, state.room?.status, nav, toast]);

  // follow a host-initiated rematch
  const lastEvent = state.events[state.events.length - 1];
  useEffect(() => {
    if (lastEvent?.type === 'rematch' && lastEvent.actor !== uid && id) {
      const code = String(lastEvent.payload.code ?? '');
      toast(`Rematch lobby ${code} is open`, 'success');
      api.joinRematch(id, code).then((rid) => nav(`/room/${rid}`)).catch(() => {});
    }
  }, [lastEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <div className="h-full grid place-items-center"><Spinner label="Syncing room" /></div>;
  if (state.error || !state.room) {
    return (
      <div className="h-full grid place-items-center p-6 text-center">
        <div>
          <p className="text-danger font-mono">{state.error ?? 'Room unavailable'}</p>
          <Link to="/"><Button className="mt-4" variant="ghost">Back to base</Button></Link>
        </div>
      </div>
    );
  }
  const props = { ...state, me, uid, loop };
  if (state.room.status === 'lobby') return <Lobby {...props} />;
  if (state.room.status === 'ended') return <Results {...props} />;
  return <Game {...props} />;
}

export type RoomProps = ReturnType<typeof useRoom> & { me: ReturnType<typeof useRoom>['players'][number] | undefined; uid: string; loop: ReturnType<typeof useGameLoop> };
