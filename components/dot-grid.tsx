"use client";

import React, { useEffect, useRef } from "react";

interface DotGridProps {
  className?: string;
  spacing?: number;       // Espaçamento entre os pontos em px (padrão: 26)
  lightRadius?: number;   // Raio de iluminação do cursor em px (padrão: 160)
  colorRgb?: string;      // Cor RGB dos pontos (padrão: "167, 139, 250" - violeta/roxo)
  baseRadius?: number;    // Raio do ponto apagado (padrão: 1.0)
  expandRadius?: number;  // Expansão máxima do ponto com mouse (padrão: 2.7)
}

export function DotGrid({
  className = "",
  spacing = 26,
  lightRadius = 160,
  colorRgb = "167, 139, 250",
  baseRadius = 1.0,
  expandRadius = 2.7,
}: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respeitar preferências de acessibilidade
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    interface Dot {
      x: number;
      y: number;
      o: number;   // opacidade atual
      to: number;  // meta de opacidade (twinkle)
      os: number;  // step/velocidade
    }

    let dots: Dot[] = [];
    const mouse = { x: null as number | null, y: null as number | null };
    let rafId = 0;
    let isRunning = true;
    const radiusSq = lightRadius * lightRadius;

    function resize() {
      if (!parent || !canvas || !ctx) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        dots = [];
        const cols = Math.ceil(width / spacing);
        const rows = Math.ceil(height / spacing);
        const offset = spacing / 2;

        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < rows; row++) {
            const initialOpacity = Math.random() * 0.2 + 0.1;
            dots.push({
              x: spacing * col + offset,
              y: spacing * row + offset,
              o: initialOpacity,
              to: initialOpacity,
              os: Math.random() * 0.005 + 0.002,
            });
          }
        }
      }
    }

    function render(animateIdle: boolean) {
      if (!canvas || !ctx) return;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      const hasMouse = mouse.x !== null && mouse.y !== null;

      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];

        // Pulsação sutil orgânica de fundo
        if (animateIdle) {
          dot.o += dot.os;
          if (dot.o >= dot.to || dot.o <= 0.1) {
            dot.os = -dot.os;
            dot.o = Math.max(0.1, Math.min(dot.o, 0.3));
            dot.to = Math.random() * 0.2 + 0.1;
          }
        }

        // Proximidade com o cursor do mouse
        let proximity = 0;
        if (hasMouse) {
          const dx = dot.x - mouse.x!;
          const dy = dot.y - mouse.y!;
          const distSq = dx * dx + dy * dy;

          if (distSq < radiusSq) {
            // Decaimento quadrático suave
            proximity = Math.max(0, 1 - Math.sqrt(distSq) / lightRadius);
            proximity *= proximity;
          }
        }

        const finalOpacity = Math.min(1, dot.o + 0.7 * proximity);
        const r = baseRadius + expandRadius * proximity;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${colorRgb}, ${finalOpacity.toFixed(3)})`;
        ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      if (isRunning) {
        render(true);
        rafId = requestAnimationFrame(loop);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      if (prefersReducedMotion) render(false);
    }

    function onPointerLeave() {
      mouse.x = null;
      mouse.y = null;
      if (prefersReducedMotion) render(false);
    }

    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    parent.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", resize);

    // Economia de recursos: pausa quando fora do viewport
    const observer = new IntersectionObserver(([entry]) => {
      if (prefersReducedMotion) return render(false);
      if (entry.isIntersecting && !isRunning) {
        isRunning = true;
        loop();
      } else if (!entry.isIntersecting) {
        isRunning = false;
        cancelAnimationFrame(rafId);
      }
    });
    observer.observe(parent);

    if (prefersReducedMotion) {
      render(false);
    } else {
      loop();
    }

    return () => {
      isRunning = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      parent.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, [spacing, lightRadius, colorRgb, baseRadius, expandRadius]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 ${className}`}
    />
  );
}


