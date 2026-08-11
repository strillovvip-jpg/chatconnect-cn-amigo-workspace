export function getConsultationHeaderClassName() {
  return "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b px-4 pb-3 pt-[max(1rem,calc(var(--app-safe-area-top)+0.9rem))]";
}

export function getConsultationHeaderActionClassName() {
  return "flex shrink-0 items-center justify-end gap-2";
}

export function getConsultationHeaderSecondaryClassName() {
  return "col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-2";
}

export function getConsultationTabBarClassName() {
  return "flex shrink-0 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
}

export function getConsultationHeaderBrand() {
  return {
    ariaLabel: "Song Jin",
    badgeText: "Song Jin",
    title: "Song Jin",
  };
}
