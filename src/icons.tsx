import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>;
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

export function LoaderIcon(props: IconProps) {
  return <Icon {...props}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></Icon>;
}

export function LocateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Icon>
  );
}

export function SingleSentenceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5H5v3M16 5h3v3M5 16v3h3M19 16v3h-3" />
      <path d="M8 12h8" />
    </Icon>
  );
}

export function FullTextIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 6h14M5 12h14M5 18h10" /></Icon>;
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return <Icon {...props} fill="currentColor" stroke="none"><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.8l10.2-7.2a1 1 0 0 0 0-1.6L8.6 4c-.7-.5-1.6 0-1.6.8Z" /></Icon>;
}

export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <path d="M10 6h10M10 12h10M10 18h10" />
    </Icon>
  );
}

export function SlidersExpandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 6h6M9 12h6M9 18h6" />
      <path d="m17 9 3-3 3 3M20 6v12" />
    </Icon>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
      <path d="M18.5 5.8v12.4a1 1 0 0 1-1.6.8l-8-6.2a1 1 0 0 1 0-1.6l8-6.2a1 1 0 0 1 1.6.8Z" />
    </Icon>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
      <path d="M5.5 5.8v12.4a1 1 0 0 0 1.6.8l8-6.2a1 1 0 0 0 0-1.6L7.1 5a1 1 0 0 0-1.6.8Z" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </Icon>
  );
}
