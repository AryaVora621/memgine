"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GraphNode {
  id: string;
  label: string;
  role: string;
  group: number;
  val: number;
  timestamp: string;
  fullContent: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphViewProps {
  projectId: string;
  refreshKey: number;
}

const GROUP_COLORS: Record<number, string> = {
  1: '#EAEAEA',  // user messages — white
  2: '#E61919',  // assistant messages — red
  3: '#666666',  // system — dim
};

// Shape the force-graph library hands to canvas callbacks; our GraphNode data
// plus the runtime coordinates it injects.
type FGNode = Partial<Omit<GraphNode, 'id'>> & { x?: number; y?: number; id?: string | number };

export default function GraphView({ projectId, refreshKey }: GraphViewProps) {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  // Build the memory graph straight from Supabase: one node per message,
  // linked by explicit parent_id or by conversation order within a chat.
  useEffect(() => {
    if (!projectId || !supabase) return;
    supabase
      .from('memories')
      .select('id, role, content, timestamp, parent_id, chat_id')
      .eq('project_id', projectId)
      .order('timestamp', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const rows = data as {
          id: string;
          role: string;
          content: string | null;
          timestamp: string;
          parent_id: string | null;
          chat_id: string | null;
        }[];
        const nodes: GraphNode[] = rows.map(m => ({
          id: m.id,
          label: (m.content || '').substring(0, 24),
          role: m.role,
          group: m.role === 'user' ? 1 : m.role === 'assistant' ? 2 : 3,
          val: 3,
          timestamp: m.timestamp,
          fullContent: m.content || '',
        }));
        const ids = new Set(rows.map(m => m.id));
        const links: GraphLink[] = [];
        const lastByChat: Record<string, string> = {};
        for (const m of rows) {
          const chatKey = m.chat_id || 'none';
          if (m.parent_id && ids.has(m.parent_id)) {
            links.push({ source: m.parent_id, target: m.id });
          } else if (lastByChat[chatKey]) {
            links.push({ source: lastByChat[chatKey], target: m.id });
          }
          lastByChat[chatKey] = m.id;
        }
        setGraphData({ nodes, links });
      });
  }, [projectId, refreshKey]);

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDims({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const paintNode = useCallback((node: FGNode, ctx: CanvasRenderingContext2D) => {
    const size = node.val || 3;
    const color = GROUP_COLORS[node.group ?? 0] || '#EAEAEA';
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // Square nodes — brutalist geometry
    ctx.fillStyle = color;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x - size, y - size, size * 2, size * 2);

    // Label
    const label = node.label || String(node.id ?? '').substring(0, 8);
    ctx.font = '2.5px JetBrains Mono, monospace';
    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x, y + size + 2);
  }, []);

  const isEmpty = graphData.nodes.length === 0;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isEmpty ? (
        <div className="graph-empty">
          <samp>[ NO MEMORY NODES ]</samp>
          <samp className="graph-empty-sub">SEND MESSAGES TO BUILD THE GRAPH</samp>
        </div>
      ) : (
        <>
          <ForceGraph2D
            graphData={graphData}
            nodeLabel=""
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
              const size = (node.val || 3) + 2;
              ctx.fillStyle = color;
              ctx.fillRect((node.x ?? 0) - size, (node.y ?? 0) - size, size * 2, size * 2);
            }}
            onNodeHover={(node: FGNode | null) => setHovered((node as GraphNode) || null)}
            linkColor={() => '#333333'}
            linkWidth={1}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={0.9}
            linkDirectionalParticles={1}
            linkDirectionalParticleColor={() => '#E61919'}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.008}
            width={dims.w}
            height={dims.h}
            backgroundColor="#0A0A0A"
          />
          {hovered && (
            <div className="graph-tooltip">
              <samp className="graph-tooltip-role">
                {hovered.role === 'user' ? '< USER >' : '< ASSISTANT >'}
                {' '}{hovered.timestamp}
              </samp>
              <samp className="graph-tooltip-text">{hovered.fullContent}</samp>
            </div>
          )}
        </>
      )}
    </div>
  );
}
