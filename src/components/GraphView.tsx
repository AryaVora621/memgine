"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';
import { GLOBAL_PROJECT_ID } from '@/lib/tags';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GraphNode {
  id: string;
  label: string;
  kind: 'room' | 'fact';
  memType: string;
  room: string;
  val: number;
  description: string;
  fullContent: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  crossLink: boolean;
}

interface GraphViewProps {
  projectId: string;
  refreshKey: number;
}

const TYPE_COLORS: Record<string, string> = {
  user: '#EAEAEA',      // who the operator is — white
  feedback: '#E61919',  // how to work — red
  project: '#19B36B',   // ongoing work — green
  reference: '#D97706', // external pointers — amber
};
const ROOM_COLOR = '#666666';

// Shape the force-graph library hands to canvas callbacks; our GraphNode data
// plus the runtime coordinates it injects.
type FGNode = Partial<Omit<GraphNode, 'id'>> & { x?: number; y?: number; id?: string | number };

export default function GraphView({ projectId, refreshKey }: GraphViewProps) {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  // Build the palace graph straight from Supabase: rooms are hubs, each stored
  // memory is a node in its room, and [[name]] references become cross-links.
  useEffect(() => {
    if (!projectId || !supabase) return;
    supabase
      .from('project_memories')
      .select('id, project_id, room_name, fact_content, name, description, mem_type')
      .in('project_id', [projectId, GLOBAL_PROJECT_ID])
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const rows = data as {
          id: string;
          project_id: string;
          room_name: string | null;
          fact_content: string;
          name: string | null;
          description: string | null;
          mem_type: string | null;
        }[];

        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const roomIds = new Set<string>();
        const idBySlug: Record<string, string> = {};

        for (const m of rows) {
          const room = (m.room_name || 'GENERAL').toUpperCase();
          const roomId = `room:${room}`;
          if (!roomIds.has(roomId)) {
            roomIds.add(roomId);
            nodes.push({
              id: roomId,
              label: room,
              kind: 'room',
              memType: 'room',
              room,
              val: 6,
              description: '',
              fullContent: '',
            });
          }
          const slug = m.name || m.fact_content.substring(0, 24);
          const isGlobal = m.project_id === GLOBAL_PROJECT_ID;
          nodes.push({
            id: m.id,
            label: (isGlobal ? '✦ ' : '') + slug.substring(0, 28),
            kind: 'fact',
            memType: m.mem_type || 'project',
            room,
            val: 3,
            description: m.description || '',
            fullContent: m.fact_content,
          });
          if (m.name) idBySlug[m.name] = m.id;
          links.push({ source: roomId, target: m.id, crossLink: false });
        }

        // [[name]] references between memories become dashed cross-links.
        for (const m of rows) {
          const refs = m.fact_content.match(/\[\[([^\]]+)\]\]/g) || [];
          for (const raw of refs) {
            const target = idBySlug[raw.slice(2, -2).trim()];
            if (target && target !== m.id) {
              links.push({ source: m.id, target, crossLink: true });
            }
          }
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
    const color = node.kind === 'room' ? ROOM_COLOR : TYPE_COLORS[node.memType || 'project'] || '#EAEAEA';
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // Square nodes — brutalist geometry. Rooms are hollow, memories solid.
    if (node.kind === 'room') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - size, y - size, size * 2, size * 2);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - size, y - size, size * 2, size * 2);
    }

    const label = node.label || String(node.id ?? '').substring(0, 8);
    ctx.font = node.kind === 'room' ? 'bold 3px JetBrains Mono, monospace' : '2.5px JetBrains Mono, monospace';
    ctx.fillStyle = node.kind === 'room' ? '#999999' : '#777777';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x, y + size + 2);
  }, []);

  const isEmpty = graphData.nodes.length === 0;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isEmpty ? (
        <div className="graph-empty">
          <samp>[ PALACE EMPTY ]</samp>
          <samp className="graph-empty-sub">STORE FACTS IN THE MEM_PALACE TO BUILD THE MAP</samp>
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
            linkColor={l => ((l as unknown as GraphLink).crossLink ? '#E61919' : '#333333')}
            linkWidth={1}
            linkDirectionalParticles={l => ((l as unknown as GraphLink).crossLink ? 1 : 0)}
            linkDirectionalParticleColor={() => '#E61919'}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.008}
            width={dims.w}
            height={dims.h}
            backgroundColor="#0A0A0A"
          />
          <div className="graph-tooltip" style={{ pointerEvents: 'none', opacity: hovered && hovered.kind === 'fact' ? 1 : 0 }}>
            {hovered && hovered.kind === 'fact' && (
              <>
                <samp className="graph-tooltip-role">
                  {hovered.label} · {hovered.memType.toUpperCase()} · {hovered.room}
                </samp>
                {hovered.description && <samp className="graph-tooltip-text">{hovered.description}</samp>}
                <samp className="graph-tooltip-text">{hovered.fullContent}</samp>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
