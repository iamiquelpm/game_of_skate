import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWebRTC } from '../hooks/useWebRTC';
import { 
  Trophy, 
  Clock, 
  Check, 
  X, 
  RotateCcw, 
  ArrowLeft, 
  Users,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Copy,
  CheckCircle2,
  Share2,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface GameProps {
  roomId: string;
  role: 'player' | 'spectator';
  onLeave: () => void;
}

interface GameState {
  turn: number;
  letters: [string[], string[]];
  phase: 'setting' | 'replicating' | 'evaluating';
  timer: number;
  lastActionTime: number;
  message?: string | null;
  eAttempts: [number, number];
}

export default function Game({ roomId, role, onLeave }: GameProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const isSpectator = role === 'spectator';
  const { localVideoRef, remoteVideo1Ref, remoteVideo2Ref, stream } = useWebRTC(roomId, socket, isSpectator, players, waiting);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareRoom = async () => {
    const shareData = {
      title: 'Game of SKATE',
      text: `Join my Game of SKATE room! Code: ${roomId}`,
      url: window.location.href
    };

    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      copyRoomCode();
    }
  };

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.emit('join-room', { roomId, role });

    newSocket.on('room-update', ({ players, gameState }) => {
      console.log('Room update received:', { playersCount: players.length, gameState });
      setPlayers(players);
      setGameState(gameState);
      if (players.length >= 2) {
        setWaiting(false);
      } else {
        setWaiting(true);
      }
    });

    newSocket.on('game-start', ({ players, gameState }) => {
      console.log('Game start received:', { playersCount: players.length });
      setWaiting(false);
      setPlayers(players);
      setGameState(gameState);
    });

    newSocket.on('state-update', (newState) => {
      setGameState(newState);
      setTimeLeft(30);
    });

    newSocket.on('player-disconnected', () => {
      alert('Opponent disconnected');
      onLeave();
    });

    newSocket.on('error', (msg) => {
      alert(msg);
      onLeave();
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    if (!gameState || waiting) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const activePlayerIndex = gameState.phase === 'replicating' ? (1 - gameState.turn) : gameState.turn;
          if (socket && players[activePlayerIndex] === socket.id) {
            console.log('Timer out, emitting timer-out event');
            socket.emit('timer-out', { roomId });
          }
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, waiting, socket, players, roomId]);

  const setTrick = () => {
    if (socket) {
      socket.emit('trick-set', { roomId });
    }
  };

  const evaluate = (result: 'valid' | 'invalid' | 'repeat') => {
    if (socket) {
      socket.emit('evaluate-trick', { roomId, result });
    }
  };

  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => track.enabled = isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (stream) {
      stream.getVideoTracks().forEach(track => track.enabled = isVideoOff);
      setIsVideoOff(!isVideoOff);
    }
  };

  if (waiting) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-zinc-950 text-white">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl space-y-8 text-center"
        >
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Users className="w-8 h-8 text-indigo-400" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black italic uppercase tracking-tighter">Lobby Created</h2>
            <p className="text-zinc-500 font-medium">Waiting for Player 2 to join...</p>
          </div>

          {/* Local Camera Preview while waiting */}
          {!isSpectator && stream && (
            <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden border border-zinc-800 shadow-inner">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest border border-white/10">
                Camera Preview
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="p-6 bg-black/40 rounded-3xl border border-zinc-800 space-y-3">
              <p className="text-[10px] uppercase font-black tracking-widest text-zinc-600">Room Access Code</p>
              <div className="flex items-center justify-center gap-4">
                <span className="font-mono text-4xl font-black tracking-[0.2em] text-indigo-400">{roomId}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={copyRoomCode}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold transition-all active:scale-95 group"
              >
                {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-zinc-400 group-hover:text-white" />}
                {copied ? 'COPIED' : 'COPY'}
              </button>
              <button 
                onClick={shareRoom}
                className="flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-bold transition-all active:scale-95"
              >
                <Share2 className="w-5 h-5" />
                SHARE
              </button>
            </div>
          </div>

          <div className="pt-4 space-y-6">
            <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
              <p className="text-xs text-indigo-300/70 font-medium leading-relaxed">
                The game will start automatically when the second player joins.
              </p>
            </div>

            <button 
              onClick={onLeave}
              className="flex items-center justify-center gap-2 w-full px-6 py-4 text-zinc-500 hover:text-red-400 font-bold uppercase tracking-widest text-xs transition-colors group"
            >
              <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Leave Room
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!gameState) return null;

  const myIndex = players.indexOf(socket?.id || '');
  const isMyTurn = !isSpectator && gameState.turn === myIndex;
  const opponentIndex = isSpectator ? -1 : (1 - myIndex);
  const winnerIndex = gameState.letters[0].length === 5 ? 1 : gameState.letters[1].length === 5 ? 0 : null;

  if (winnerIndex !== null) {
    const iWon = winnerIndex === myIndex;
    const winnerText = isSpectator 
      ? `Player ${winnerIndex + 1} Won!` 
      : (iWon ? 'You Won!' : 'You Lost!');

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-6"
        >
          <div className="p-6 bg-indigo-500/10 rounded-3xl border border-indigo-500/20 inline-block">
            <Trophy className={cn("w-20 h-20", (iWon || isSpectator) ? "text-yellow-400" : "text-zinc-600")} />
          </div>
          <h1 className="text-5xl font-black tracking-tighter italic uppercase">
            {winnerText}
          </h1>
          <p className="text-zinc-400">Final Score: {gameState.letters[0].join('') || '-'} vs {gameState.letters[1].join('') || '-'}</p>
          <button
            onClick={onLeave}
            className="px-8 py-4 bg-white text-black font-bold rounded-2xl hover:bg-zinc-200 transition-all active:scale-95"
          >
            Back to Menu
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black">
      {/* Game Message Overlay */}
      <AnimatePresence>
        {gameState.message && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-full shadow-lg font-bold"
          >
            {gameState.message}
          </motion.div>
        )}
        {/* Extra Life Message for E */}
        {!gameState.message && (
          (() => {
            const activePlayerIndex = gameState.phase === 'replicating' ? (1 - gameState.turn) : gameState.turn;
            const isEAtRisk = gameState.letters[activePlayerIndex].length === 4;
            const attempt = gameState.eAttempts[activePlayerIndex];
            if (isEAtRisk) {
              return (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white px-6 py-3 rounded-full shadow-lg font-bold uppercase tracking-wider"
                >
                  {attempt === 0 ? "Final Letter: Attempt 1/2" : "Last chance: second attempt"}
                </motion.div>
              );
            }
            return null;
          })()
        )}
      </AnimatePresence>
      {/* Header */}
      <div className="p-4 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onLeave} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <button 
              onClick={copyRoomCode}
              className="flex items-center gap-2 font-mono text-[10px] text-zinc-500 bg-zinc-800 px-2 py-1 rounded tracking-widest hover:bg-zinc-700 transition-colors group"
            >
              ROOM: {roomId}
              {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-zinc-600 group-hover:text-white" />}
            </button>
            <div className={cn(
              "text-[10px] font-bold uppercase tracking-tighter mt-1 px-2 py-0.5 rounded w-fit",
              isSpectator ? "bg-zinc-800 text-zinc-400" : "bg-indigo-500/20 text-indigo-400"
            )}>
              {isSpectator ? 'Spectator' : `Player ${myIndex + 1}`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Scoreboard */}
          <div className="flex gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase text-zinc-500 font-bold">
                {isSpectator ? 'Player 1' : 'You'}
              </div>
              <div className="flex gap-1">
                {'SKATE'.split('').map((l, i) => (
                  <span key={i} className={cn(
                    "w-5 h-5 flex items-center justify-center rounded text-xs font-black",
                    gameState.letters[isSpectator ? 0 : myIndex].includes(l) ? "bg-red-500 text-white" : "bg-zinc-800 text-zinc-600"
                  )}>{l}</span>
                ))}
              </div>
            </div>
            <div className="text-left">
              <div className="text-[10px] uppercase text-zinc-500 font-bold">
                {isSpectator ? 'Player 2' : 'Opponent'}
              </div>
              <div className="flex gap-1">
                {'SKATE'.split('').map((l, i) => (
                  <span key={i} className={cn(
                    "w-5 h-5 flex items-center justify-center rounded text-xs font-black",
                    gameState.letters[isSpectator ? 1 : opponentIndex].includes(l) ? "bg-red-500 text-white" : "bg-zinc-800 text-zinc-600"
                  )}>{l}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Video Grid */}
      <div className="flex-1 relative grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
        {/* Remote Video 1 (Opponent or Player 1) */}
        <div className="relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
          <video
            ref={remoteVideo1Ref}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-xs font-medium border border-white/10">
            {isSpectator ? 'Player 1' : 'Opponent'}
          </div>
          {!remoteVideo1Ref.current?.srcObject && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
              <VideoOff className="w-12 h-12" />
            </div>
          )}
        </div>

        {/* Local Video or Remote Video 2 */}
        <div className="relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
          <video
            ref={isSpectator ? remoteVideo2Ref : localVideoRef}
            autoPlay
            playsInline
            muted={!isSpectator}
            className={cn("w-full h-full object-cover", !isSpectator && "scale-x-[-1]")}
          />
          <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-xs font-medium border border-white/10">
            {isSpectator ? 'Player 2' : 'You'}
          </div>
          {!isSpectator && (
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button onClick={toggleMute} className="p-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 hover:bg-white/10">
                {isMuted ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4" />}
              </button>
              <button onClick={toggleVideo} className="p-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 hover:bg-white/10">
                {isVideoOff ? <VideoOff className="w-4 h-4 text-red-500" /> : <Video className="w-4 h-4" />}
              </button>
            </div>
          )}
          {isSpectator && !remoteVideo2Ref.current?.srcObject && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
              <VideoOff className="w-12 h-12" />
            </div>
          )}
          {!isSpectator && !stream && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
              <VideoOff className="w-12 h-12" />
            </div>
          )}
        </div>

        {/* Overlay: Game Info & Controls */}
        <div className="absolute inset-x-0 bottom-8 flex flex-col items-center pointer-events-none px-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={gameState.phase + gameState.turn}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-xl pointer-events-auto"
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-6">
                {/* Status & Timer */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-xs uppercase font-black tracking-widest text-indigo-400">
                      {gameState.phase === 'setting' ? 'Setting Trick' : 'Replicating Trick'}
                    </h3>
                    <p className="text-xl font-bold">
                      {gameState.turn === 0 ? 'Player 1' : 'Player 2'}'s Turn
                    </p>
                  </div>
                  <div className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-2xl font-mono text-xl font-bold",
                    timeLeft < 10 ? "bg-red-500/20 text-red-500" : "bg-zinc-800 text-white"
                  )}>
                    <Clock className="w-5 h-5" />
                    {timeLeft}s
                  </div>
                </div>

                {/* Phase Specific Content */}
                <div className="min-h-[80px] flex items-center justify-center">
                  {gameState.phase === 'setting' ? (
                    isMyTurn && !isSpectator ? (
                      <div className="flex w-full justify-center">
                        <button
                          onClick={setTrick}
                          className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-bold text-lg shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-3"
                        >
                          <Check className="w-6 h-6" />
                          TRICK SET
                        </button>
                      </div>
                    ) : (
                      <p className="text-zinc-400 italic">Waiting for {gameState.turn === 0 ? 'Player 1' : 'Player 2'} to set a trick...</p>
                    )
                  ) : (
                    <div className="text-center space-y-6 w-full">
                      {/* Evaluation Controls */}
                      {isMyTurn && !isSpectator && (
                        <div className="grid grid-cols-3 gap-3">
                          <button
                            onClick={() => evaluate('valid')}
                            className="flex flex-col items-center gap-2 p-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-2xl border border-emerald-500/20 transition-all active:scale-95"
                          >
                            <Check className="w-6 h-6" />
                            <span className="text-xs font-bold uppercase">Valid</span>
                          </button>
                          <button
                            onClick={() => evaluate('invalid')}
                            className="flex flex-col items-center gap-2 p-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl border border-red-500/20 transition-all active:scale-95"
                          >
                            <X className="w-6 h-6" />
                            <span className="text-xs font-bold uppercase">Fail</span>
                          </button>
                          <button
                            onClick={() => evaluate('repeat')}
                            className="flex flex-col items-center gap-2 p-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-2xl border border-zinc-700 transition-all active:scale-95"
                          >
                            <RotateCcw className="w-6 h-6" />
                            <span className="text-xs font-bold uppercase">Repeat</span>
                          </button>
                        </div>
                      )}
                      {!isMyTurn && !isSpectator && (
                        <p className="text-zinc-400 italic text-lg">Do the trick! Opponent will judge you.</p>
                      )}
                      {isSpectator && (
                        <p className="text-zinc-400 italic">Watching {gameState.turn === 0 ? 'Player 1' : 'Player 2'} replicate the trick...</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
