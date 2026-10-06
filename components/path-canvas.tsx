'use client';

import { useEffect, useRef, useState } from 'react';
import type { NodeRuntime, PathNode } from '@/lib/types';
import { CANVAS_SIZE } from '@/lib/data/path-nodes';
import { STATUS_META } from '@/lib/path';

const NODE_RADIUS = 30;
const STAGE_LABELS: Record<number, string> = {
  1: '阶段 1 · 词汇与阅读基建',
  2: '阶段 2 · 句型与语块',
  3: '阶段 3 · 扩展与进阶',
};

interface Props {
  nodes: PathNode[];
  runtime: Record<string, NodeRuntime>;
  selectedId?: string | null;
  onSelect?: (nodeId: string | null) => void;
}

/** 学习路径可视化：原生 Canvas 2D，含依赖边、进度弧、待复习脉冲与命中检测 */
export function PathCanvas({ nodes, runtime, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<string | null>(null);
  const scaleRef = useRef(1);
  const dataRef = useRef({ nodes, runtime, selectedId });
  const [, forceHover] = useState(0);

  dataRef.current = { nodes, runtime, selectedId };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = wrap.clientWidth;
      const scale = width / CANVAS_SIZE.width;
      const height = CANVAS_SIZE.height * scale;
      scaleRef.current = scale;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const scale = scaleRef.current;
      const { nodes: list, runtime: rt, selectedId: sel } = dataRef.current;
      const w = CANVAS_SIZE.width * scale;
      const h = CANVAS_SIZE.height * scale;

      ctx.clearRect(0, 0, w, h);

      // 背景网格
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += 40 * scale) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 40 * scale) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      // 阶段标签
      ctx.save();
      ctx.fillStyle = 'rgba(148,163,184,0.65)';
      ctx.font = `${12 * Math.max(scale, 0.8)}px system-ui, sans-serif`;
      ctx.fillText(STAGE_LABELS[1], 12 * scale, 40 * scale);
      ctx.fillText(STAGE_LABELS[2], 12 * scale, 350 * scale);
      ctx.fillText(STAGE_LABELS[3], 12 * scale, 500 * scale);
      ctx.restore();

      // 依赖边
      const pos = (n: PathNode) => ({ x: n.x * scale, y: n.y * scale });
      ctx.save();
      for (const node of list) {
        for (const prereqId of node.prereqIds) {
          const from = list.find((n) => n.id === prereqId);
          if (!from) continue;
          const a = pos(from);
          const b = pos(node);
          const done = rt[prereqId]?.status === 'mastered';
          ctx.strokeStyle = done ? 'rgba(52,211,153,0.55)' : 'rgba(148,163,184,0.28)';
          ctx.lineWidth = (done ? 2.4 : 1.6) * scale;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.bezierCurveTo(a.x + 60 * scale, a.y, b.x - 60 * scale, b.y, b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      // 节点
      for (const node of list) {
        const p = pos(node);
        const r = NODE_RADIUS * scale;
        const status = rt[node.id]?.status ?? 'locked';
        const meta = STATUS_META[status];
        const learned = rt[node.id]?.learned ?? 0;
        const total = rt[node.id]?.total ?? 0;
        const ratio = total ? learned / total : 0;
        const isHover = hoverRef.current === node.id;
        const isSelected = sel === node.id;

        // 待复习脉冲
        if (status === 'due') {
          const t = (time % 2000) / 2000;
          ctx.save();
          ctx.globalAlpha = 0.35 * (1 - t);
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 2 * scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + t * 22 * scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 外圈
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(24,24,27,0.85)';
        ctx.fill();
        ctx.lineWidth = (isSelected ? 3 : isHover ? 2.4 : 1.6) * scale;
        ctx.strokeStyle = isSelected ? '#ffffff' : meta.color;
        if (status === 'locked') ctx.setLineDash([5 * scale, 4 * scale]);
        ctx.stroke();
        ctx.restore();

        // 进度弧
        if (ratio > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r - 5 * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 3.2 * scale;
          ctx.lineCap = 'round';
          ctx.stroke();
          ctx.restore();
        }

        // 中心内容
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = status === 'mastered' ? meta.color : '#e4e4e7';
        ctx.font = `600 ${13 * Math.max(scale, 0.75)}px system-ui, sans-serif`;
        ctx.fillText(`${Math.round(ratio * 100)}%`, p.x, p.y - 2 * scale);
        ctx.fillStyle = 'rgba(161,161,170,0.9)';
        ctx.font = `${10 * Math.max(scale, 0.75)}px system-ui, sans-serif`;
        ctx.fillText(`${learned}/${total}`, p.x, p.y + 12 * scale);
        ctx.restore();

        // 标题
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = status === 'locked' ? 'rgba(113,113,122,0.9)' : '#fafafa';
        ctx.font = `600 ${13 * Math.max(scale, 0.8)}px system-ui, sans-serif`;
        ctx.fillText(node.title, p.x, p.y + r + 18 * scale);
        if (node.subtitle) {
          ctx.fillStyle = 'rgba(148,163,184,0.75)';
          ctx.font = `${11 * Math.max(scale, 0.8)}px system-ui, sans-serif`;
          ctx.fillText(node.subtitle, p.x, p.y + r + 34 * scale);
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const hitTest = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = scaleRef.current;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    for (const node of dataRef.current.nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return node.id;
    }
    return null;
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className="w-full cursor-pointer rounded-xl border border-border/60 bg-card/40"
        onMouseMove={(e) => {
          const id = hitTest(e.clientX, e.clientY);
          if (id !== hoverRef.current) {
            hoverRef.current = id;
            forceHover((n) => n + 1);
          }
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
          forceHover((n) => n + 1);
        }}
        onClick={(e) => onSelect?.(hitTest(e.clientX, e.clientY))}
      />
    </div>
  );
}
