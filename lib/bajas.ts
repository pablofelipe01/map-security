/**
 * Nodos dados de baja: aparatos que siguen en la tabla `nodes` pero que ya no
 * son parte de la operación.
 *
 * La tabla `nodes` es un inventario acumulado —el ingestor nunca borra— así que
 * un radio retirado hace meses sigue apareciendo en la flota como "Sin señal",
 * con su último fix de hace 46 o 70 días, y ocupando una fila del panel que
 * nadie va a atender. Esto los saca de la vista.
 *
 * Se listan UNO POR UNO y con el motivo escrito, en vez de ocultarlos con una
 * regla de antigüedad ("más de N días sin reportar"). Esa regla sería más corta
 * y estaría mal: la razón de existir del panel es justamente mostrar la máquina
 * que dejó de reportar. Un umbral escondería sola, y en silencio, a la que se
 * quedó sin señal esta semana — que es la única que de verdad hay que mirar.
 * Dar de baja un nodo es una decisión, no un cálculo.
 *
 * Esto sólo afecta a la VISTA: no borra nada, y el histórico del nodo sigue
 * accesible por su URL directa (`#/m/<node_id>`) si alguna vez hay que auditar
 * lo que hizo antes de salir de servicio.
 */

export const NODOS_DADOS_DE_BAJA: Record<string, string> = {
  // Era el radio de la Torre Oficinas. Se reemplazó por !9ea29bc4 ("Mission
  // Pack"), que es el que hoy hace de gateway y firma los traceroutes. No se
  // oye desde el 15-abr-2026; su relevo quedó registrado en `mesh_sites`.
  "!2ad9c5df": "Radio retirado de la Torre Oficinas (reemplazado por !9ea29bc4)",

  // Nunca entregó coordenadas y lleva meses mudo. No está montado en ninguna
  // máquina ni instalado en ningún sitio.
  "!86591d35": "Fuera de servicio: sin reportes desde jun-2026",
};

/** true si el nodo está dado de baja y no debe aparecer en la app. */
export function estaDadoDeBaja(nodeId: string): boolean {
  return nodeId in NODOS_DADOS_DE_BAJA;
}
