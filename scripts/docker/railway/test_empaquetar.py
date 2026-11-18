import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from empaquetar import empaquetar


class PlantillaPublica(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dist = Path(temp.name) / "dist"
        self.fuente = Path(temp.name) / "fuente"
        self.dist.mkdir()
        self.rail = self.fuente / "scripts/docker/railway"
        self.rail.mkdir(parents=True)
        (self.rail.parent / "Dockerfile").write_text("FROM debian:bookworm-slim\n")
        for nombre in ["iniciar.sh", "obtener.sh", "guia-publica.md"]:
            (self.rail / nombre).write_text("Fuente pública de prueba\n", encoding="utf8")
        (self.rail / "estable.txt").write_text("pin antiguo de la copia de desarrollo\n")
        (self.rail / "archivo-privado.txt").write_text("contenido ajeno a la plantilla\n")
        (self.dist / "notas-internas.txt").write_text("fuera del archivo público\n")
        self.hashes = {}
        for arch in ("x64", "arm64"):
            nombre = f"colonia-core-2.36.99-linux-{arch}.tar.gz"
            datos = f"bundle ficticio de {arch}".encode()
            (self.dist / nombre).write_bytes(datos)
            dig = hashlib.sha256(datos).hexdigest()
            (self.dist / f"{nombre}.sha256").write_text(f"{dig}  {nombre}\n", encoding="ascii")
            self.hashes[arch] = dig

    def test_solo_cinco_archivos_y_pin_de_los_bundles_de_esta_version(self):
        archivo = empaquetar("2.36.99", self.dist, self.fuente)
        with zipfile.ZipFile(archivo) as z:
            self.assertEqual(sorted(z.namelist()), sorted([
                "README.md", "scripts/docker/Dockerfile", "scripts/docker/railway/estable.txt",
                "scripts/docker/railway/iniciar.sh", "scripts/docker/railway/obtener.sh",
            ]))
            self.assertEqual(z.read("scripts/docker/railway/estable.txt").decode(),
                             f"2.36.99\nx64 {self.hashes['x64']}\narm64 {self.hashes['arm64']}\n")
            self.assertEqual(z.read("README.md"), (self.rail / "guia-publica.md").read_bytes())
        primera = archivo.read_bytes()
        (self.rail / "iniciar.sh").touch()
        self.assertEqual(empaquetar("2.36.99", self.dist, self.fuente).read_bytes(), primera)
        self.assertEqual(Path(f"{archivo}.sha256").read_text().strip(),
                         f"{hashlib.sha256(primera).hexdigest()}  {archivo.name}")

    def test_rechaza_bundle_alterado_o_ausente_y_version_invalida(self):
        corrupto = self.dist / "colonia-core-2.36.99-linux-arm64.tar.gz"
        corrupto.write_bytes(b"alterado")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            empaquetar("2.36.99", self.dist, self.fuente)
        corrupto.unlink()
        with self.assertRaises(FileNotFoundError):
            empaquetar("2.36.99", self.dist, self.fuente)
        with self.assertRaisesRegex(ValueError, "versión"):
            empaquetar("../otro", self.dist, self.fuente)
        self.assertFalse(any(self.dist.glob("*.zip*")))


if __name__ == "__main__":
    unittest.main()
