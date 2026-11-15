import type { CartItem as CartItemType, CreditCartItem } from '../../types'
import { STRINGS } from '../../constants/strings'
import { isWeightLine, lineQuantityLabel } from '../../lib/cartLines'
import { formatMoney } from '@/lib/money'

interface CartListProps {
  cart: CartItemType[]
  /** Líneas de crédito pendientes del cliente cargado (no son productos nuevos). */
  creditLines?: CreditCartItem[]
  creditCustomerName?: string
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

/** Líneas de deuda del cliente: se muestran aparte, con su estado y la deuda actual. */
export const CreditLinesList = ({ lines, customerName }: { lines: CreditCartItem[]; customerName?: string }) => {
  if (lines.length === 0) return null
  return (
    <div className="mb-4" data-testid="credit-lines">
      <div className="text-xs font-bold text-center mb-2 pos-primary">
        Deuda de {customerName ?? 'cliente'} · {lines.length} {lines.length === 1 ? 'línea pendiente' : 'líneas pendientes'}
      </div>
      <div className="space-y-2.5 pr-1">
        {lines.map(l => (
          <div key={l.saleItemId} className="pos-line" data-testid="credit-line">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-bold text-[17px] pos-ink truncate">{l.name}</div>
                <span className="pos-tag is-promo">{l.status === 'PENDING' ? 'Pendiente' : 'Pagado'}</span>
              </div>
              <div className="text-sm pos-muted mt-0.5">
                <span className="font-mono">#{l.code}</span> · {l.quantity} u. · Venta #{l.saleId} {fmtDate(l.soldAt)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs pos-muted">Deuda actual</div>
              <div className="text-xl font-extrabold pos-ink pos-num">{formatMoney(l.debt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const CartList = ({ cart, creditLines = [], creditCustomerName }: CartListProps) => {
  if (cart.length === 0 && creditLines.length > 0) {
    return <CreditLinesList lines={creditLines} customerName={creditCustomerName} />
  }
  if (cart.length === 0) {
    return (
      <div className="pos-empty py-8">
        <div className="pos-empty-icon">🛒</div>
        <div className="text-lg font-bold pos-ink-2">{STRINGS.CART_EMPTY}</div>
        <div className="text-sm">Ingresá un código para empezar la venta</div>
      </div>
    )
  }

  return (
    <div>
    <CreditLinesList lines={creditLines} customerName={creditCustomerName} />
    <div className="space-y-2.5 pr-1">
      {[...cart].reverse().map((item, reverseIndex) => {
        const displayIndex = reverseIndex + 1
        const byWeight = isWeightLine(item)
        const isNewest = reverseIndex === 0
        const discounted = item.originalPrice && item.originalPrice !== item.price
        return (
          <div
            // La fila más nueva se remonta al cambiar la cantidad para repetir la animación
            key={isNewest ? `${item.id}-${item.quantity}` : item.id}
            className={`pos-line ${isNewest ? 'is-new' : ''}`}
          >
            <div className="pos-line-idx">{displayIndex}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-bold text-[17px] pos-ink truncate">{item.name}</div>
                {item.fixedTotal && (
                  <span className="pos-tag is-scale" title="El importe viene de la etiqueta de la balanza">⚖ Etiqueta</span>
                )}
                {item.promotionId && <span className="pos-tag is-promo">Promo</span>}
              </div>
              <div className="text-sm pos-muted mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="font-mono">#{item.code.startsWith('000') ? '000' : item.code}</span>
                <span className="pos-line-qty pos-num">{byWeight ? lineQuantityLabel(item) : `${item.quantity} ×`}</span>
                <span className="pos-num">{formatMoney(item.price || 0)}{byWeight ? ' /kg' : ''}</span>
                {discounted && (
                  <span className="line-through">{formatMoney(item.originalPrice || 0)}</span>
                )}
              </div>
              {item.promotionName && (
                <div className="text-xs mt-1 truncate" style={{ color: '#7C3AED' }}>{item.promotionName}</div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xl font-extrabold pos-ink pos-num">{formatMoney(item.total || 0)}</div>
              <div className="text-xs pos-muted pos-num">({byWeight ? lineQuantityLabel(item) : `${item.quantity} unid.`})</div>
              {discounted && (
                <div className="text-xs font-semibold pos-success mt-0.5">
                  Ahorro: {formatMoney(((item.originalPrice || 0) - (item.price || 0)) * item.quantity)}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
    </div>
  )
}
