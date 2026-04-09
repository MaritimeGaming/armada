import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { AudioSequence, DifficultyLevel, GameState, NavySide, Winner } from '@/lib/armada-game';
import {
  areAllShipsSunk,
  resolveTargetingSequence,
  selectAppTargetIndex,
  setCellState,
  setCellTargeting,
} from '@/lib/armada-game';

type AppTurnPhase = 'idle' | 'scheduled' | 'previewing';

type UseAppTargetingSequenceParams = {
  difficulty: DifficultyLevel;
  gameOverOpen: boolean;
  gameState: GameState | null;
  onConcludeGame: (winner: Winner, state: GameState) => void;
  onPlayAudioSequence: (sequence: AudioSequence) => void;
  onSetActiveView: (side: NavySide) => void;
  setGameState: Dispatch<SetStateAction<GameState | null>>;
  storageKey: string;
};

export function useAppTargetingSequence({
  difficulty,
  gameOverOpen,
  gameState,
  onConcludeGame,
  onPlayAudioSequence,
  onSetActiveView,
  setGameState,
  storageKey,
}: UseAppTargetingSequenceParams) {
  const appTargetPreviewRef = useRef<number | null>(null);
  const appTurnPhaseRef = useRef<AppTurnPhase>('idle');

  useEffect(() => {
    if (!gameState || gameOverOpen || gameState.currentTurn !== 'app') {
      appTargetPreviewRef.current = null;
      appTurnPhaseRef.current = 'idle';
      return;
    }

    if (appTurnPhaseRef.current !== 'idle') {
      return;
    }

    const previewIndex = appTargetPreviewRef.current ?? selectAppTargetIndex(gameState.player, difficulty);

    if (previewIndex === null) {
      return;
    }

    appTargetPreviewRef.current = previewIndex;
    appTurnPhaseRef.current = 'scheduled';

    const scrollToPlayerDelay = window.setTimeout(() => {
      onSetActiveView('player');
    }, 1000);

    const previewDelay = window.setTimeout(() => {
      appTurnPhaseRef.current = 'previewing';

      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'app') {
          return currentState;
        }

        const currentlyTargetingIndex = currentState.player.cells.findIndex((cell) => cell.targeting);
        let nextPlayer = currentState.player;

        if (currentlyTargetingIndex !== -1 && currentlyTargetingIndex !== previewIndex) {
          nextPlayer = setCellTargeting(nextPlayer, currentlyTargetingIndex, false);
        }

        if (!nextPlayer.cells[previewIndex]?.targeting) {
          nextPlayer = setCellTargeting(nextPlayer, previewIndex, true);
        }

        if (nextPlayer === currentState.player) {
          return currentState;
        }

        const nextState: GameState = {
          ...currentState,
          player: nextPlayer,
        };

        window.localStorage.setItem(storageKey, JSON.stringify(nextState));
        return nextState;
      });
    }, 1500);

    const executeTargetingDelay = window.setTimeout(() => {
      setGameState((currentState) => {
        if (!currentState || currentState.currentTurn !== 'app') {
          return currentState;
        }

        appTargetPreviewRef.current = null;
        appTurnPhaseRef.current = 'idle';

        const playerWithTargetedCell = setCellState(currentState.player, previewIndex, {
          effect: 'targeted',
          targeting: false,
        });
        const { navy: updatedPlayer, audioSequence } = resolveTargetingSequence(playerWithTargetedCell, [previewIndex]);
        const nextState: GameState = {
          ...currentState,
          currentTurn: 'player',
          player: updatedPlayer,
        };

        window.localStorage.setItem(storageKey, JSON.stringify(nextState));
        onPlayAudioSequence(audioSequence);

        if (areAllShipsSunk(updatedPlayer)) {
          onConcludeGame('app', nextState);
        } else {
          window.setTimeout(() => {
            onSetActiveView('enemy');
          }, 1000);
        }

        return nextState;
      });
    }, 2250);

    return () => {
      window.clearTimeout(scrollToPlayerDelay);
      window.clearTimeout(previewDelay);
      window.clearTimeout(executeTargetingDelay);

      if (appTurnPhaseRef.current !== 'idle') {
        appTurnPhaseRef.current = 'idle';
      }
    };
  }, [difficulty, gameOverOpen, gameState, onConcludeGame, onPlayAudioSequence, onSetActiveView, setGameState, storageKey]);
}
