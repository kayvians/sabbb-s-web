import { ArrowLeft } from 'lucide-react';

interface FloatingBackButtonProps {
  onClick: () => void;
  label?: string;
  variant?: 'default' | 'exam';
}

export function FloatingBackButton({
  onClick,
  label = 'BACK',
  variant = 'default',
}: FloatingBackButtonProps) {
  return (
    <div className="sticky top-[4.75rem] z-20 flex justify-start pointer-events-none mb-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Kembali (${label})`}
        className={`pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl font-display text-lg font-extrabold tracking-wider shadow-lg transition-all cursor-pointer border-2 ${
          variant === 'exam'
            ? 'bg-[#0757B8] hover:bg-[#0D4FA8] text-white border-[#101B45] dark:bg-[#14244F] dark:border-[#D5BF50]/70'
            : 'bg-[#D8DCE3] hover:bg-white text-[#101B45] border-[#0B0F19] dark:bg-[#192650] dark:hover:bg-[#23346B] dark:text-white dark:border-[#D5BF50]/60'
        }`}
      >
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </button>
    </div>
  );
}
