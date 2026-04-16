import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

export function useWebRTC(roomId: string, socket: Socket | null, isSpectator: boolean, players: string[], waiting: boolean) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideo1Ref = useRef<HTMLVideoElement>(null);
  const remoteVideo2Ref = useRef<HTMLVideoElement>(null);
  
  // Map of peer connections: socketId -> RTCPeerConnection
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Map of queued ICE candidates: socketId -> RTCIceCandidateInit[]
  const pendingIceCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const playersRef = useRef<string[]>(players);
  const waitingRef = useRef<boolean>(waiting);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);

  // Effect for local stream acquisition
  useEffect(() => {
    if (isSpectator) return;

    let active = true;
    const getMedia = async () => {
      try {
        console.log('WebRTC: Requesting local media stream (video + audio)');
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
        });
        
        if (!active) {
          console.log('WebRTC: Effect cleaned up before stream acquired, stopping tracks');
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        console.log('WebRTC: Local stream acquired. Tracks:', localStream.getTracks().map(t => ({
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState
        })));

        setStream(localStream);
        streamRef.current = localStream;
        
        // Immediate attachment to local ref if available
        if (localVideoRef.current) {
          console.log('WebRTC: Immediately attaching local stream to video element');
          localVideoRef.current.srcObject = localStream;
        }
      } catch (err) {
        console.error('WebRTC: Media error:', err);
      }
    };

    getMedia();
    return () => {
      active = false;
      console.log('WebRTC: Stopping local media stream');
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setStream(null);
    };
  }, [isSpectator]);

  // Sync streams to video elements whenever waiting state or streams change
  useEffect(() => {
    const syncVideos = () => {
      console.log('WebRTC: Syncing streams to video elements. Waiting:', waiting);
      
      // Local video - Always show if stream exists, even if waiting
      if (!isSpectator && streamRef.current && localVideoRef.current) {
        if (localVideoRef.current.srcObject !== streamRef.current) {
          console.log('WebRTC: Attaching local stream to video element');
          localVideoRef.current.srcObject = streamRef.current;
        }
      }

      if (waiting) return;

      // Remote videos
      if (isSpectator) {
        // Spectator sees both players
        playersRef.current.forEach((playerId, index) => {
          const remoteStream = remoteStreams.current.get(playerId);
          const videoRef = index === 0 ? remoteVideo1Ref : remoteVideo2Ref;
          if (remoteStream && videoRef.current) {
            if (videoRef.current.srcObject !== remoteStream) {
              console.log(`WebRTC: Attaching remote stream from player ${index + 1} (${playerId}) to video element`);
              videoRef.current.srcObject = remoteStream;
            }
          }
        });
      } else {
        // Player sees the other player
        const otherPlayerId = playersRef.current.find(id => id !== socket?.id);
        if (otherPlayerId) {
          const remoteStream = remoteStreams.current.get(otherPlayerId);
          if (remoteStream && remoteVideo1Ref.current) {
            if (remoteVideo1Ref.current.srcObject !== remoteStream) {
              console.log(`WebRTC: Attaching remote stream from opponent (${otherPlayerId}) to video element`);
              remoteVideo1Ref.current.srcObject = remoteStream;
            }
          }
        }
      }
    };

    syncVideos();
    // Also sync on a short interval to ensure elements are bound if they were hidden/shown
    const interval = setInterval(syncVideos, 2000);
    return () => clearInterval(interval);
  }, [waiting, stream, players, isSpectator, socket?.id]);

  // Add tracks to all existing peer connections when stream becomes available
  useEffect(() => {
    if (!stream) return;
    
    console.log('WebRTC: Stream became available, adding tracks to existing PCs');
    peerConnections.current.forEach((pc, targetId) => {
      const alreadyHasTracks = pc.getSenders().length > 0;
      if (!alreadyHasTracks) {
        console.log(`WebRTC: Adding tracks to existing PC for ${targetId}`);
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }
    });
  }, [stream]);

  // Effect for signaling
  useEffect(() => {
    if (!socket) return;

    console.log('WebRTC: Attaching signaling listeners');

    const createPeerConnection = (targetId: string, isInitiator: boolean) => {
      if (peerConnections.current.has(targetId)) {
        console.log(`WebRTC: Peer connection for ${targetId} already exists`);
        return peerConnections.current.get(targetId)!;
      }

      console.log(`WebRTC: Creating peer connection for ${targetId} (initiator: ${isInitiator})`);
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ],
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`WebRTC: Generated ICE candidate for ${targetId}:`, event.candidate.candidate);
          socket.emit('ice-candidate', { roomId, targetId, candidate: event.candidate });
        } else {
          console.log(`WebRTC: ICE candidate gathering complete for ${targetId}`);
        }
      };

      pc.ontrack = (event) => {
        console.log(`WebRTC: Received track from ${targetId}. Kind: ${event.track.kind}`);
        const remoteStream = event.streams[0];
        if (!remoteStream) {
          console.warn(`WebRTC: Received track from ${targetId} but no stream associated`);
          return;
        }
        
        remoteStreams.current.set(targetId, remoteStream);
        
        // Immediate attachment to correct video element
        if (isSpectator) {
          const playerIndex = playersRef.current.indexOf(targetId);
          const videoRef = playerIndex === 0 ? remoteVideo1Ref : remoteVideo2Ref;
          if (videoRef.current) {
            console.log(`WebRTC: Immediately attaching remote track from ${targetId} to video element`);
            videoRef.current.srcObject = remoteStream;
          }
        } else {
          if (remoteVideo1Ref.current) {
            console.log(`WebRTC: Immediately attaching remote track from ${targetId} to video element`);
            remoteVideo1Ref.current.srcObject = remoteStream;
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`WebRTC: ICE connection state for ${targetId}: ${pc.iceConnectionState}`);
      };

      pc.onconnectionstatechange = () => {
        console.log(`WebRTC: Connection state for ${targetId}: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
          console.warn(`WebRTC: Connection failed for ${targetId}. ICE state: ${pc.iceConnectionState}`);
        }
      };

      pc.onsignalingstatechange = () => {
        console.log(`WebRTC: Signaling state for ${targetId}: ${pc.signalingState}`);
      };

      if (!isSpectator && streamRef.current) {
        console.log(`WebRTC: Adding tracks to PC for ${targetId}`);
        streamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, streamRef.current!);
        });
      }

      peerConnections.current.set(targetId, pc);
      return pc;
    };

    const processPendingIceCandidates = async (targetId: string) => {
      const pc = peerConnections.current.get(targetId);
      const candidates = pendingIceCandidates.current.get(targetId);
      if (pc && pc.remoteDescription && candidates) {
        console.log(`WebRTC: Processing ${candidates.length} pending ICE candidates for ${targetId}`);
        for (const candidate of candidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error(`WebRTC: Error adding pending ICE candidate for ${targetId}:`, err);
          }
        }
        pendingIceCandidates.current.delete(targetId);
      }
    };

    const handleOffer = async ({ fromId, offer }: { fromId: string, offer: RTCSessionDescriptionInit }) => {
      console.log(`WebRTC: Received offer from ${fromId}`);
      const pc = createPeerConnection(fromId, false);
      
      if (pc.signalingState !== 'stable') {
        console.log(`WebRTC: Ignoring offer from ${fromId} - state is ${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`WebRTC: Remote description set for offer from ${fromId}`);
        await processPendingIceCandidates(fromId);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { roomId, targetId: fromId, answer });
      } catch (err) {
        console.error(`WebRTC: Error handling offer from ${fromId}:`, err);
      }
    };

    const handleAnswer = async ({ fromId, answer }: { fromId: string, answer: RTCSessionDescriptionInit }) => {
      console.log(`WebRTC: Received answer from ${fromId}`);
      const pc = peerConnections.current.get(fromId);
      if (!pc) {
        console.warn(`WebRTC: No PC found for answer from ${fromId}`);
        return;
      }

      if (pc.signalingState !== 'have-local-offer') {
        console.log(`WebRTC: Ignoring answer from ${fromId} - state is ${pc.signalingState}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`WebRTC: Remote description set for answer from ${fromId}`);
        await processPendingIceCandidates(fromId);
      } catch (err) {
        console.error(`WebRTC: Error handling answer from ${fromId}:`, err);
      }
    };

    const handleIceCandidate = async ({ fromId, candidate }: { fromId: string, candidate: RTCIceCandidateInit }) => {
      console.log(`WebRTC: Received ICE candidate from ${fromId}`);
      const pc = peerConnections.current.get(fromId);
      
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`WebRTC: ICE candidate successfully added for ${fromId}`);
        } catch (err) {
          console.error(`WebRTC: Error adding ICE candidate from ${fromId}:`, err);
        }
      } else {
        console.log(`WebRTC: Queuing ICE candidate from ${fromId} (remoteDescription not ready). Signaling state: ${pc?.signalingState}`);
        const pending = pendingIceCandidates.current.get(fromId) || [];
        pending.push(candidate);
        pendingIceCandidates.current.set(fromId, pending);
      }
    };

    const handleGameStart = async ({ players }: { players: string[] }) => {
      console.log('WebRTC: Game start event received', players);
      if (!isSpectator) {
        const otherPlayerId = players.find(id => id !== socket.id);
        if (otherPlayerId && players[0] === socket.id) {
          if (peerConnections.current.has(otherPlayerId)) {
            console.log(`WebRTC: PC for other player ${otherPlayerId} already exists, skipping offer`);
            return;
          }
          const pc = createPeerConnection(otherPlayerId, true);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { roomId, targetId: otherPlayerId, offer });
          } catch (err) {
            console.error(`WebRTC: Error creating offer for ${otherPlayerId}:`, err);
          }
        }
      }
    };

    const handleUserJoined = async ({ userId, role }: { userId: string, role: string }) => {
      console.log('WebRTC: User joined event received', { userId, role });
      if (!isSpectator && role === 'spectator') {
        if (peerConnections.current.has(userId)) {
          console.log(`WebRTC: PC for spectator ${userId} already exists, skipping offer`);
          return;
        }
        const pc = createPeerConnection(userId, true);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { roomId, targetId: userId, offer });
        } catch (err) {
          console.error(`WebRTC: Error creating offer for spectator ${userId}:`, err);
        }
      }
    };

    const handleRoomUpdate = async ({ spectators }: { spectators: string[] }) => {
      if (!isSpectator && spectators) {
        for (const spectatorId of spectators) {
          if (!peerConnections.current.has(spectatorId)) {
            console.log(`WebRTC: Offering to existing spectator ${spectatorId}`);
            const pc = createPeerConnection(spectatorId, true);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit('offer', { roomId, targetId: spectatorId, offer });
            } catch (err) {
              console.error(`WebRTC: Error creating offer for existing spectator ${spectatorId}:`, err);
            }
          }
        }
      }
    };

    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('game-start', handleGameStart);
    socket.on('user-joined', handleUserJoined);
    socket.on('room-update', handleRoomUpdate);

    return () => {
      console.log('WebRTC: Removing signaling listeners and closing PCs');
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('game-start', handleGameStart);
      socket.off('user-joined', handleUserJoined);
      socket.off('room-update', handleRoomUpdate);
      
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      remoteStreams.current.clear();
    };
  }, [roomId, socket, isSpectator]);

  return { localVideoRef, remoteVideo1Ref, remoteVideo2Ref, stream };
}
