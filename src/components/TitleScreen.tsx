import { Button } from '@/components/ui/button';

// The background art already has the "ARMADA" wordmark baked in near the
// bottom, so this component only needs to add the Play button -- no
// separate title text to lay out or keep in sync with the art.
const TITLE_SCREEN_IMAGE = `${import.meta.env.BASE_URL}images/title-screen.jpg`;

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  return (
    <main
      className="relative flex min-h-screen items-end justify-center bg-slate-950 bg-cover bg-center p-8 pb-16"
      style={{ backgroundImage: `url(${TITLE_SCREEN_IMAGE})` }}
    >
      <Button
        type="button"
        size="lg"
        onClick={onPlay}
        className="w-full max-w-xs bg-cyan-400 text-lg font-semibold uppercase tracking-[0.2em] text-slate-950 shadow-[0_8px_30px_rgba(34,211,238,0.35)] hover:bg-cyan-300"
      >
        Play
      </Button>
    </main>
  );
}

export default TitleScreen;
