"use client";

interface Props {
  camOn: boolean;
  micOn: boolean;
  forcedOff: string | null;
  narratorOn: boolean;
  chatOpen: boolean;
  unread: number;
  onCam: () => void;
  onMic: () => void;
  onNarrator: () => void;
  onChat: () => void;
  onRules: () => void;
  onLeave: () => void;
}

export default function ControlBar(p: Props) {
  return (
    <nav
      aria-label="Table controls"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      {p.forcedOff && <p className="pt-1.5 text-center text-xs text-night">{p.forcedOff}</p>}
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-0.5 px-1 py-1.5 sm:justify-center sm:gap-2 sm:px-2 sm:py-2">
        <Btn icon={p.camOn ? "📷" : "🚫"} label={p.camOn ? "Stop video" : "Start video"} active={!p.camOn} onClick={p.onCam} disabled={!!p.forcedOff} />
        <Btn icon={p.micOn ? "🎙️" : "🔇"} label={p.micOn ? "Mute" : "Unmute"} active={!p.micOn} onClick={p.onMic} disabled={!!p.forcedOff} />
        <Btn icon={p.narratorOn ? "🔊" : "🔈"} label={`Narrator ${p.narratorOn ? "on" : "off"}`} active={!p.narratorOn} onClick={p.onNarrator} />
        <Btn icon="💬" label="Chat" active={p.chatOpen} onClick={p.onChat} badge={p.unread} />
        <Btn icon="📜" label="House rules" onClick={p.onRules} />
        <Btn icon="🚪" label="Leave table" onClick={p.onLeave} danger />
      </div>
    </nav>
  );
}

function Btn({
  icon,
  label,
  onClick,
  active,
  danger,
  disabled,
  badge,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-0.5 py-1.5 text-[10px] leading-tight font-semibold transition sm:flex-none sm:px-3 sm:text-xs disabled:opacity-40 ${
        danger ? "text-blood hover:bg-blood/15" : active ? "bg-white/15 text-cream" : "text-muted hover:bg-white/10 hover:text-cream"
      }`}
    >
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
      <span className="text-center sm:whitespace-nowrap">{label}</span>
      {!!badge && (
        <span className="absolute right-1 top-0.5 rounded-full bg-amber px-1.5 text-[10px] font-bold text-ink">{badge > 9 ? "9+" : badge}</span>
      )}
    </button>
  );
}
