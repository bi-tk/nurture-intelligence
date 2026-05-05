'use client'

interface FunnelStage {
  stage: string
  count: number
  rate: number
}

export default function FunnelChart({ data }: { data: FunnelStage[] }) {
  const max = data[0]?.count || 1

  return (
    <div className="space-y-2.5">
      {data.map((stage, i) => {
        const prev = data[i - 1]
        const stageConv = prev && prev.count > 0
          ? parseFloat((stage.count / prev.count * 100).toFixed(2))
          : null
        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <div className="w-24 shrink-0">
              <p className="text-white/60 text-xs truncate">{stage.stage}</p>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-6 bg-graphite-700 rounded overflow-hidden">
                <div
                  className="h-full gradient-core-flow rounded transition-all"
                  style={{ width: `${(stage.count / max) * 100}%`, opacity: 1 - i * 0.1 }}
                />
              </div>
              <span className="text-white/70 text-xs font-mono w-14 text-right">
                {stage.count.toLocaleString()}
              </span>
            </div>
            {stageConv !== null ? (
              <span className="text-white/30 text-xs font-mono w-12 text-right shrink-0">
                {stageConv.toFixed(2)}%
              </span>
            ) : (
              <span className="w-12 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}
