import React, { useState } from 'react';
import { Trophy, Play, Plus, Users } from 'lucide-react';
import { motion } from 'motion/react';

interface LandingProps {
  onJoin: (roomId: string, role: 'player' | 'spectator', playerName: string) => void;
}

export default function Landing({ onJoin }: LandingProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const handleJoin = (e: React.FormEvent, role: 'player' | 'spectator' = 'player') => {
    e.preventDefault();
    const finalName = name.trim() || 'Skater';
    if (code.trim()) {
      onJoin(code.trim().toUpperCase(), role, finalName);
    }
  };

  const createRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    const finalName = name.trim() || 'Skater';
    onJoin(randomCode, 'player', finalName);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-zinc-950">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-12 text-center"
      >
        {/* Logo Section */}
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
            <Trophy className="w-12 h-12 text-indigo-400" />
          </div>
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic">Game of SKATE</h1>
            <p className="text-zinc-500 text-sm font-medium">Real-time battle • Video call • Turn-based</p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Name Section */}
          <div className="space-y-3">
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="YOUR NAME"
                maxLength={12}
                className="w-full px-6 py-5 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-white uppercase tracking-widest font-bold text-center placeholder:text-zinc-700"
              />
            </div>
            <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Identify yourself for the battle</p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-900"></span>
            </div>
          </div>

          {/* Create Section */}
          <div className="space-y-3">
            <button
              onClick={createRoom}
              className="w-full flex items-center justify-center gap-3 px-6 py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-xl shadow-indigo-500/20 group"
            >
              <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" />
              CREATE NEW ROOM
            </button>
            <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Start a new private match</p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-900"></span>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-black tracking-[0.2em]">
              <span className="bg-zinc-950 px-4 text-zinc-700">Or join a friend</span>
            </div>
          </div>

          {/* Join Section */}
          <div className="space-y-4">
            <div className="relative">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ENTER ROOM CODE"
                className="w-full px-6 py-5 bg-zinc-900/50 border border-zinc-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-white uppercase tracking-[0.3em] font-mono text-center placeholder:text-zinc-700 placeholder:tracking-normal"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={(e) => handleJoin(e as any, 'player')}
                disabled={!code.trim()}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all active:scale-95"
              >
                <Play className="w-4 h-4" />
                PLAY
              </button>
              <button
                onClick={(e) => handleJoin(e as any, 'spectator')}
                disabled={!code.trim()}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-white font-bold rounded-xl transition-all active:scale-95"
              >
                <Users className="w-4 h-4" />
                WATCH
              </button>
            </div>
          </div>
        </div>

        <div className="pt-4 text-[10px] text-zinc-700 font-bold uppercase tracking-widest">
          No login required • Private rooms
        </div>
      </motion.div>
    </div>
  );
}
