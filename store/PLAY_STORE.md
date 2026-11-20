# Publishing ShadowHunt Pro on Google Play

Everything in this folder is ready to upload:

| File | Play Console field |
|---|---|
| `icon-512.png` | App icon (512×512) |
| `feature-graphic.png` | Feature graphic (1024×500) |
| `screenshots/1-welcome.png` … `6-game-other-side.png` | Phone screenshots (1080×1920) |
| **ShadowHuntPro-playstore.aab** | App bundle. Download it from https://github.com/jeeveshpatil/skills-github-pages/releases/tag/android-latest (it appears there once the signing secrets are set and a build has run). |

Privacy policy URL: **https://jeeveshpatil.github.io/skills-github-pages/privacy.html**

---

## Store listing text

**App name** (max 30): `ShadowHunt Pro: GPS Manhunt`

**Short description** (max 80):
`Real-world hide & seek. Hunters track blurred GPS pings while the zone shrinks.`

**Full description**:
```
The city is the arena.

ShadowHunt Pro turns your neighbourhood, park or campus into a live multiplayer manhunt. Hunters track Shadows through timed, blurred GPS reveals while a shrinking zone forces everyone to move. Run, hide, outsmart — then tag them for real.

FIVE GAME MODES
• Classic Hunt – Hunters vs Shadows. Survive the clock or get caught.
• Battle Royale – an aggressive shrinking zone eliminates anyone caught outside.
• Team vs Team – Red vs Blue. Everyone hunts, everyone hides.
• Infection – every Shadow you tag joins the horde.
• Last Shadow Standing – the final survivor wins alone.

BUILT FOR REAL-WORLD PLAY
• Private rooms with codes and passwords, or public matchmaking
• Live map, tactical compass and proximity alerts
• Shrinking and moving zones, custom arena boundaries and safe zones
• Tag confirmation with host rulings, automatic win detection
• Host dashboard with live roster, disputes and anti-cheat signals
• Team voice chat, replays, XP, ranks, achievements and tournaments

FAIR AND PRIVATE BY DESIGN
• Opponents never see your exact position – only blurred, server-timed reveals
• All game rules are enforced on the server
• GPS-spoofing and teleport detection (not foolproof, but it helps hosts spot cheating)
• Live locations are deleted after each match; replay tracks after 48 hours
• Delete your account and data anytime in the app

SAFETY FIRST
Any player can hit SOS to pause the match for everyone. Always stay aware of traffic and play in safe, public places with people you know.
```

**Category:** Games → Action (or Adventure) · **Tags:** Multiplayer, Location-based, Outdoor
**Contact email:** your email (required by Google, shown publicly)

---

## App content forms (Policy → App content)

**Privacy policy:** the URL above.

**Ads:** No, the app does not contain ads.

**App access:** "All functionality is available without special access" (guest sign-in, no password needed).

**Content rating** (IARC questionnaire): Category *Game*. Violence: none (tagging is touch-only, no weapons or combat imagery). Users can interact: **Yes** (players see each other's names in matches; voice chat is optional). Shares location: **Yes**. Digital purchases: No. Expected result: around PEGI 3/7 or Everyone, with an "Users Interact / Shares Location" notice.

**Target audience:** **18 and over** (simplest; avoids the Families policy because of real-world location sharing). 16+ also works if you prefer.

**Data safety:**
| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Location → **Precise location** | Yes | No* | No (needed to play) | App functionality, Fraud prevention/security |
| Personal info → **Name** (callsign) | Yes | No | No | App functionality, Account management |
| Personal info → **Email address** | Yes | No | **Yes** (only for email sign-in) | Account management |
| Audio → **Voice or sound recordings** | No (voice chat is live and never stored) | – | – | – |
| App activity → **Other user-generated content** (maps, match stats) | Yes | No | No | App functionality |
| Device or other IDs | No | – | – | – |

\*"Shared" in Google's sense means sent to third parties. Showing blurred positions to other players is part of the app's function, and service providers (Supabase hosting) don't count as sharing.
- Data is **encrypted in transit**: Yes.
- Users can **request deletion**: Yes, in the app (Profile → Delete my account) and via the web link in the privacy policy.

**Foreground service permission** (Policy → App content → Foreground service permissions): declare **Location** (`FOREGROUND_SERVICE_LOCATION`).
- Use case: "During an active match, the app tracks the player's location continuously so the multiplayer game (zone, reveals, tag distance checks) keeps working while the screen is off. Started only when the user joins a match, shows a persistent notification, and stops when they leave."
- Google asks for a **short video** (unlisted YouTube link is fine): record your screen while joining a match, show the "ShadowHunt match in progress" notification, lock and unlock the phone, then leave the match and show the notification disappearing.

**Location permissions:** the app only asks for *while-in-use* location (no `ACCESS_BACKGROUND_LOCATION`), so no background-location declaration is needed.

**Government apps / Financial features / Health / News:** No.

---

## Release steps

1. **Testing → Closed testing → Create track.** Upload `ShadowHuntPro-playstore.aab` and add testers by email.
   New personal developer accounts must run a closed test with **at least 12 testers for 14 continuous days** before Google unlocks Production access.
2. After the 14 days: **Production → Create new release.** Upload the newest `.aab` and roll out.
3. Each new version: push or merge to `main`. CI builds a new `.aab` with a higher version code automatically. Download it from the release page and upload it to a new Production release.

Keep your **upload key** (`shadowhunt-upload.jks` plus its passwords) private and backed up. With Play App Signing enabled (the default), Google holds the real app-signing key, and a lost upload key can be reset in Play Console → Setup → App signing.
