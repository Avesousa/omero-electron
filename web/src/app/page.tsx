import { redirect } from 'next/navigation'

// El POS es la raíz de este servicio (el redirect de next.config cubre el caso normal).
export default function Home() {
  redirect('/pos')
}
