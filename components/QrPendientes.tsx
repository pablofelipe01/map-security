"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialogo } from "./Form";

/**
 * El QR que lleva a la lista de vueltas pendientes (`/despacho/pendientes`).
 *
 * LA DIRECCIÓN SALE DE DONDE ESTÁ ABIERTA LA APP, no de una constante. Así el
 * QR que se imprime desde producción apunta a producción, sin que haya una URL
 * que actualizar a mano el día que cambie el dominio. La contracara: generado
 * desde `localhost` no sirve para escanear con el celular, y por eso se
 * muestra la dirección debajo — para que se note.
 */
export default function QrPendientes({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [svg, setSvg] = useState("");
  const [png, setPng] = useState("");

  useEffect(() => {
    const u = `${window.location.origin}/despacho/pendientes`;
    setUrl(u);
    // Corrección media (M): aguanta un QR impreso algo sucio o arrugado sin
    // volverse tan denso que cueste leerlo de lejos.
    const op = { errorCorrectionLevel: "M" as const, margin: 2 };
    void QRCode.toString(u, { ...op, type: "svg" }).then(setSvg);
    void QRCode.toDataURL(u, { ...op, width: 1024 }).then(setPng);
  }, []);

  const local = /\/\/(localhost|127\.|192\.168\.|10\.)/.test(url);

  return (
    <Dialogo ancho={340} onClose={onClose}>
      <div className="panel-title mb-1">QR · vueltas pendientes</div>
      <p className="mb-3 text-[11px] leading-tight text-ink-3">
        Al escanearlo se abre la lista de vueltas pendientes por recoger que
        todavía no salen. Se actualiza sola cada minuto.
      </p>

      <div
        className="mx-auto aspect-square w-full max-w-[260px] bg-white [&>svg]:h-full [&>svg]:w-full"
        // El SVG lo arma la librería a partir de nuestra propia URL.
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <p className="mono mt-2 break-all text-center text-[10.5px] text-ink-2">
        {url}
      </p>
      {local && (
        <p className="mt-2 rounded-[10px] bg-[#fdf4e3] px-3 py-2 text-[11px] leading-tight text-st-detenida">
          Esta dirección es local: un celular no la va a abrir. Genera el QR
          desde la app publicada.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cerrar
        </button>
        <a
          className={`btn text-center ${png ? "" : "pointer-events-none opacity-50"}`}
          href={png || undefined}
          download="qr-vueltas-pendientes.png"
        >
          Descargar PNG
        </a>
      </div>
    </Dialogo>
  );
}
