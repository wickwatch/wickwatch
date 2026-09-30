<script setup lang="ts">
import { useId } from "vue";

/** Loading state: the logo symbol with its radar sweeping round; the blips light up as the beam passes. */
const gradient = `sweep-${useId()}`;
</script>

<template>
  <div class="spinner" role="status">
    <!-- The logo symbol (assets/logo) in the brand colours, drawn inline so its parts can move. -->
    <svg class="spinner__symbol" viewBox="0 0 120 120" width="56" height="56" aria-hidden="true">
      <defs>
        <linearGradient :id="gradient" x1="0.2" y1="0" x2="1" y2="0.6">
          <stop offset="0" class="spinner__beam spinner__beam--noon" />
          <stop offset="1" class="spinner__beam spinner__beam--two" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="50" fill="none" class="spinner__ring" stroke-width="7" />
      <!-- Turns clockwise like a radar: unlike the static logo, the leading edge (at 60°) is the bright one. -->
      <path class="spinner__sweep" d="M60 60 L60 10 A50 50 0 0 1 103.3 35 Z" :fill="`url(#${gradient})`" />
      <g class="spinner__ring" stroke-width="5" stroke-linecap="round">
        <line x1="60" y1="18" x2="60" y2="22" />
        <line x1="98" y1="60" x2="102" y2="60" />
        <line x1="60" y1="98" x2="60" y2="102" />
        <line x1="18" y1="60" x2="22" y2="60" />
      </g>
      <circle class="spinner__blip spinner__blip--near spinner__amber" cx="77" cy="27" r="4.5" />
      <g class="spinner__blip spinner__blip--far">
        <circle class="spinner__ink" cx="91" cy="38" r="3.5" />
        <circle class="spinner__ink" cx="81" cy="45" r="3" opacity="0.7" />
      </g>
      <g transform="translate(60 60) scale(0.85) translate(-60 -60)">
        <line x1="60" y1="30" x2="60" y2="90" class="spinner__wick" stroke-width="5" stroke-linecap="round" />
        <rect class="spinner__amber" x="50" y="44" width="20" height="32" rx="4" />
      </g>
    </svg>
    <span class="visually-hidden">{{ $t("overview.loading") }}</span>
  </div>
</template>

<style scoped>
.spinner {
  --spinner-ring: var(--ww-brand-blue-600);

  display: flex;
  justify-content: center;
  padding: var(--ww-space-8) 0;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .spinner {
    --spinner-ring: var(--ww-brand-blue-400);
  }
}

:root[data-theme="dark"] .spinner {
  --spinner-ring: var(--ww-brand-blue-400);
}

.spinner__ring {
  stroke: var(--spinner-ring);
}

.spinner__beam {
  stop-color: var(--spinner-ring);
}

/* Moving, the leading edge (two o'clock) is bright; the static logo has the bright edge at noon. */
.spinner__beam--noon {
  stop-opacity: 0;
}

.spinner__beam--two {
  stop-opacity: 0.55;
}

/* Ink on light, line colour on dark: the text colour of each theme. */
.spinner__ink {
  fill: var(--ww-text);
}

.spinner__wick {
  stroke: var(--ww-text);
}

.spinner__amber {
  fill: var(--ww-brand-amber-500);
}

.spinner__sweep,
.spinner__blip {
  transform-box: view-box;
  transform-origin: 60px 60px;
  animation-duration: 2.4s;
  animation-iteration-count: infinite;
}

.spinner__sweep {
  animation-name: sweep;
  animation-timing-function: linear;
}

/* The beam starts where the logo shows it (edge at 60°) and reaches the near blip (27°) at 91 %, the far ones (55°) at 99 %. */
.spinner__blip--near {
  animation-name: blip-near;
}

.spinner__blip--far {
  animation-name: blip-far;
}

@keyframes sweep {
  to {
    transform: rotate(360deg);
  }
}

@keyframes blip-near {
  0%,
  100% {
    opacity: 0.95;
  }

  60%,
  90% {
    opacity: 0.25;
  }

  91% {
    opacity: 1;
  }
}

@keyframes blip-far {
  0%,
  100% {
    opacity: 1;
  }

  65%,
  98% {
    opacity: 0.25;
  }

  99% {
    opacity: 1;
  }
}

/* Without motion: the plain logo symbol. */
@media (prefers-reduced-motion: reduce) {
  .spinner__sweep,
  .spinner__blip {
    animation: none;
  }

  .spinner__beam--noon {
    stop-opacity: 0.55;
  }

  .spinner__beam--two {
    stop-opacity: 0;
  }
}
</style>
