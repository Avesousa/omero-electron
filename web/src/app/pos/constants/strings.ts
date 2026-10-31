// Strings for POS application - Ready for i18n
export const STRINGS = {
  // Main headers
  MAIN_TITLE: "PUNTO DE VENTA",
  
  // Input modes
  INPUT_CODE_TITLE: "📦 INGRESE CÓDIGO DEL PRODUCTO",
  INPUT_QUANTITY_TITLE: "🔢 INGRESE CANTIDAD", 
  INPUT_PAYMENT_TITLE: "💰 INGRESE DINERO RECIBIDO",
  
  INPUT_CODE_SUBTITLE: "TECLA + PARA AGREGAR",
  INPUT_QUANTITY_SUBTITLE: "TECLA + PARA CONFIRMAR",
  INPUT_PAYMENT_SUBTITLE: "ENTER PARA PROCESAR",
  
  // Input placeholders and labels
  CODE_PLACEHOLDER: "Código o Código de barra",
  QUANTITY_HINT: "Ingrese la cantidad (vacío = 1 producto)",
  PAYMENT_HINT: "Ingrese el monto en efectivo recibido",
  QUANTITY_BACK_HINT: "Presione ⇧ para volver a ingresar código",
  
  // Cart
  CART_TITLE: "CARRITO DE COMPRAS",
  CART_EMPTY: "Carrito vacío",
  CART_TOTAL: "TOTAL:",
  CART_ITEMS_COUNT: "productos",
  
  // Buttons
  BTN_FINALIZE_SALE: "FINALIZAR VENTA",
  BTN_DELETE_PRODUCT: "ELIMINAR PRODUCTO",
  BTN_CONFIRM_PAYMENT: "ENTER - CONFIRMAR PAGO",
  BTN_BACK: "⇧ - VOLVER",
  BTN_CANCEL: "CANCELAR TODO",
  
  // Payment methods
  PAYMENT_METHOD_TITLE: "MÉTODO DE PAGO",
  PAYMENT_SELECT_METHOD: "SELECCIONE MÉTODO DE PAGO:",
  PAYMENT_SELECT_REMAINING: "SELECCIONE MÉTODO PARA EL RESTO:",
  PAYMENT_MERCADOPAGO: "MERCADO PAGO",
  PAYMENT_CASH: "PAGO EN EFECTIVO",
  PAYMENT_AMOUNT_TO_PAY: "MONTO A PAGAR:",
  PAYMENT_CASH_RECEIVED: "DINERO RECIBIDO:",
  PAYMENT_CHANGE: "CAMBIO A DAR:",
  PAYMENT_RETURN: "VUELTO:",
  PAYMENT_TOTAL: "TOTAL:",
  PAYMENT_REMAINING: "RESTANTE A PAGAR:",
  PAYMENT_MADE: "PAGOS REALIZADOS:",
  PAYMENT_PROCESSING_MP: "Procesando pago con Mercado Pago...",
  PAYMENT_PROCESSING_CASH: "Procesando pago en efectivo...",
  
  // Delete modal
  DELETE_TITLE: "ELIMINAR PRODUCTO",
  DELETE_INDEX_LABEL: "Índice:",
  DELETE_INSTRUCTION_1: "Escriba índice + '-' para eliminar",
  DELETE_INSTRUCTION_2: "Solo '-' para limpiar todo",
  DELETE_CLEAR_TITLE: "¿LIMPIAR TODO EL CARRITO?",
  DELETE_CLEAR_SUBTITLE: "Se eliminarán todos los",
  DELETE_CLEAR_CONFIRM: "ENTER - SÍ, LIMPIAR TODO",
  DELETE_CLEAR_CANCEL: "⇧ - NO, CANCELAR",
  
  // Keyboard guide
  KEY_WRITE: "Escribir",
  KEY_ADD: "Agregar", 
  KEY_PAY: "Pagar",
  KEY_DELETE: "Eliminar",
  KEY_BACK: "Volver",
  KEY_EXIT: "Salir",
  KEY_BACKSPACE: "Borrar",
  KEY_FINALIZE: "Finalizar",
  KEY_QUANTITY: "Cant",
  
  // Notifications
  NOTIF_PRODUCT_NOT_FOUND: "Producto no encontrado",
  NOTIF_PRODUCT_ADDED: "Producto agregado:",
  NOTIF_CART_CLEARED: "🗑️ Carrito limpiado completamente",
  NOTIF_PRODUCT_DELETED: "Eliminado:",
  NOTIF_INVALID_INDEX: "Índice inválido",
  NOTIF_BACK_TO_CODE: "Volviendo a ingresar código",
  NOTIF_NO_PRODUCTS: "No hay productos en el carrito",
  NOTIF_INVALID_AMOUNT: "Debe ingresar un monto válido",
  NOTIF_METHOD_MP: "Método seleccionado: Mercado Pago",
  NOTIF_METHOD_CASH: "Método seleccionado: Efectivo",
  NOTIF_PAYMENT_MP_SUCCESS: "¡Pago con Mercado Pago exitoso!",
  NOTIF_PAYMENT_CASH_SUCCESS: "¡Pago en efectivo registrado!",
  NOTIF_PAYMENT_SUCCESS_CHANGE: "¡Pago exitoso! Cambio:",
  NOTIF_PAYMENT_SUCCESS_RETURN: "¡Pago exitoso! Vuelto:",
  NOTIF_SALE_COMPLETED: "🎊 ¡VENTA EXITOSA! 🎉 ¡Felicidades! 🎊",
  NOTIF_SALE_PARTIAL: "Pago parcial registrado. Restante:",
  
  // Product display
  PRODUCT_QUANTITY: "Cant:",
  PRODUCT_STOCK_AVAILABLE: "Disponible:",
  
  // Common
  TOTAL_LABEL: "Total:",
  QUANTITY_LABEL: "Cantidad:",
  
} as const

export type StringKey = keyof typeof STRINGS 