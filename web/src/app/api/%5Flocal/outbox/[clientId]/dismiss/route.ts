import { dismissItem } from '@/lib/outbox/local-api'

// El cajero ya vio un envío rechazado (FAILED): deja de contarse en el aviso. El dato se conserva 30 días.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params
  return dismissItem(request, clientId)
}
