/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import Landing from './components/Landing';
import Game from './components/Game';

export default function App() {
  const [roomData, setRoomData] = useState<{ id: string, role: 'player' | 'spectator' } | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {!roomData ? (
        <Landing onJoin={(id, role) => setRoomData({ id, role })} />
      ) : (
        <Game roomId={roomData.id} role={roomData.role} onLeave={() => setRoomData(null)} />
      )}
    </div>
  );
}

