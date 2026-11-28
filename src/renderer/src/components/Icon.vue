<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string[]> = {
  folder: ['M3 7h6l2-3h10v16H3z'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v5h4'],
  plus: ['M12 5v14', 'M5 12h14'],
  pin: ['M9 3h6l-1 7 4 4H6l4-4z', 'M12 14v8'],
  rename: ['M4 16l-1 5 5-1L21 7l-4-4z', 'M14 6l4 4'],
  search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  window: ['M3 5h18v15H3z', 'M3 9h18', 'M15 2h7v7'],
  save: ['M4 3h14l3 3v15H3V3z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  chat: ['M4 4h16v13H9l-5 4z', 'M8 8h8', 'M8 12h5'],
  settings: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  ],
  moon: ['M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10'],
  monitor: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
  chevron: ['M9 5l7 7-7 7'],
  close: ['M6 6l12 12', 'M6 18L18 6'],
  link: [
    'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2',
    'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  ],
  code: ['M8 5l-6 7 6 7', 'M16 5l6 7-6 7'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  check: ['M4 12l5 5L20 6'],
  panel: ['M3 4h18v16H3z', 'M15 4v16'],
  refresh: ['M20 8a8 8 0 1 0 0 8', 'M20 3v5h-5'],
  ink: ['M12 3l8 8-8 10-8-10z', 'M12 3v12', 'M9 15h6'],
}
</script>
<template>
  <svg
    :width="size || 18"
    :height="size || 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths[name] || paths.file" :key="i" :d="d" />
  </svg>
</template>
