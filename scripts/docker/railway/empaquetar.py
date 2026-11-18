"""Crea la fuente pública de Railway y su SHA-256 desde los bundles construidos."""
import hashlib
import io
import re
import sys
import zipfile
from pathlib import Path


# La lista define todo el contenido distribuible. No se recorre el repositorio.
PUBLICOS = {
    "README.md": "scripts/docker/railway/guia-publica.md",
    "scripts/docker/Dockerfile": "scripts/docker/Dockerfile",
    "scripts/docker/railway/iniciar.sh": "scripts/docker/railway/iniciar.sh",
    "scripts/docker/railway/obtener.sh": "scripts/docker/railway/obtener.sh",
}


def empaquetar(version: str, dist: Path, fuente: Path) -> Path:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("La versión debe tener tres componentes numéricos.")

    pin = [version]
    for arch in ("x64", "arm64"):
        name = f"colonia-core-{version}-linux-{arch}.tar.gz"
        with (dist / name).open("rb") as bundle:
            digest = hashlib.file_digest(bundle, "sha256").hexdigest()
        if (dist / f"{name}.sha256").read_text(encoding="ascii").split() != [digest, name]:
            raise ValueError(f"SHA-256 incorrecto para {name}")
        pin.append(f"{arch} {digest}")

    contenidos = {"scripts/docker/railway/estable.txt": ("\n".join(pin) + "\n").encode("ascii")}
    fuente = fuente.resolve()
    for destino, ruta in PUBLICOS.items():
        archivo = fuente / ruta
        if archivo.resolve() != archivo or not archivo.is_file():
            raise ValueError(f"Se esperaba un archivo público ordinario en {ruta}")
        contenidos[destino] = archivo.read_bytes()

    # Datos y metadatos fijos para obtener los mismos bytes en todos los sistemas.
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w", compression=zipfile.ZIP_STORED) as zip_out:
        for nombre, datos in sorted(contenidos.items()):
            entrada = zipfile.ZipInfo(nombre, date_time=(2000, 1, 1, 0, 0, 0))
            entrada.create_system = 3
            entrada.external_attr = 0o100644 << 16
            zip_out.writestr(entrada, datos)
    datos = memoria.getvalue()
    salida = dist / f"colonia-railway-{version}.zip"
    salida.write_bytes(datos)
    suma = f"{hashlib.sha256(datos).hexdigest()}  {salida.name}\n"
    Path(f"{salida}.sha256").write_bytes(suma.encode("ascii"))
    return salida


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Uso: empaquetar.py VERSION DIRECTORIO_DE_ENTREGA")
    print(empaquetar(sys.argv[1], Path(sys.argv[2]), Path(__file__).resolve().parents[3]))
