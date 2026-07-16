// LINE共有の共通部品。
// navigator.share はPCブラウザでは使えない（ボタン自体が出ない）ため、
// PC・スマホ共通のフォールバックとして LINE のURLスキームで共有する。
// 全招待導線（オンボーディング・スタッフ管理・希望収集開始モーダル）で使い回す。

export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`
}

export default function LineShareButton({
  text,
  className,
  label = 'LINEで送る',
}: {
  text: string
  className?: string
  label?: string
}) {
  return (
    <a
      href={lineShareUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ||
        'px-3 py-1.5 text-xs bg-[#06C755] text-white rounded hover:opacity-90 flex items-center gap-1 font-semibold'
      }
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.03 3.57 7.4 8.4 8.04.33.07.77.22.89.5.1.26.07.66.03.92l-.14.87c-.04.26-.2 1.01.88.55 1.09-.46 5.87-3.46 8.01-5.92C21.64 13.31 22 11.79 22 10.13 22 5.64 17.52 2 12 2z" />
      </svg>
      {label}
    </a>
  )
}
