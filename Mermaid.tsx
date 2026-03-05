import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true,
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: 'Inter',
});

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && chart) {
      mermaid.render(`mermaid-${Math.random().toString(36).substr(2, 9)}`, chart).then(({ svg }) => {
        if (ref.current) {
          ref.current.innerHTML = svg;
        }
      }).catch(err => {
        console.error('Mermaid rendering error:', err);
        if (ref.current) {
          ref.current.innerHTML = `<div class="text-red-500 text-xs p-2 border border-red-200 rounded">Failed to render diagram: ${err.message}</div>`;
        }
      });
    }
  }, [chart]);

  return <div ref={ref} className="mermaid-container my-4 overflow-x-auto" />;
};

export default Mermaid;
