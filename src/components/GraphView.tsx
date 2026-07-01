"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

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

export default function GraphView({ projectId, refreshKey }: GraphViewProps) {
  const [mounted, setMounted] = useState(false);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => { setMounted(true); }, []);

  // Fetch real memory graph data
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/memory?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.nodes) setGraphData(data);
      })
      .catch(() => {});
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
  }, [mounted]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const size = node.val || 3;
    const color = GROUP_COLORS[node.group as number] || '#EAEAEA';

    // Square nodes — brutalist geometry
    ctx.fillStyle = color;
    ctx.fillRect(node.x - size, node.y - size, size * 2, size * 2);

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(node.x - size, node.y - size, size * 2, size * 2);

    // Label
    const label = node.label || node.id.substring(0, 8);
    ctx.font = '2.5px JetBrains Mono, monospace';
    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), node.x, node.y + size + 2);
  }, []);

  if (!mounted) return null;

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
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              const size = (node.val || 3) + 2;
              ctx.fillStyle = color;
              ctx.fillRect(node.x - size, node.y - size, size * 2, size * 2);
            }}
            onNodeHover={(node: any) => setHovered(node || null)}
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
