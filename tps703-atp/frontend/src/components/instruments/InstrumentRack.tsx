import { cn } from "@/lib/utils"

interface InstrumentRackProps {
  children: React.ReactNode
  className?: string
}

export function InstrumentRack({ children, className }: InstrumentRackProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 p-3",
        "bg-[#e5e7eb] rounded-lg shadow-inner",
        "border border-gray-300",
        className
      )}
    >
      {children}
    </div>
  )
}
