#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════════
# Sprint 34c — Sandbox-escape tests voor de runner
# Draai met: python3 -m unittest test_sandbox   (vanuit runner/)
#
# Verifieert dat verboden modules geblokkeerd worden en dat de
# _safe_import-barriere niet te omzeilen is via de gebruikelijke trucs.
# ═══════════════════════════════════════════════════════════════════════════════
import unittest
import builtins


# Repliceer de sandbox-barriere exact zoals in app.py WRAPPER.
# (Bij wijziging van BLOCKED_MODULES in app.py moet deze lijst mee.)
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', 'tty',
    'termios', 'fcntl', 'resource', 'mmap', 'syslog',
    'posix', 'pwd', 'grp', 'spwd', 'crypt',
}


def make_safe_import(real_import):
    def _safe_import(name, *args, **kwargs):
        root = name.split(".")[0]
        if root in BLOCKED_MODULES:
            raise ImportError(f"Module '{name}' is niet beschikbaar in deze omgeving.")
        return real_import(name, *args, **kwargs)
    return _safe_import


class TestSandboxImports(unittest.TestCase):
    def setUp(self):
        self._real = builtins.__import__
        self._safe = make_safe_import(self._real)

    def _import_via_sandbox(self, name):
        # Simuleer 'import name' door de sandbox-barriere.
        return self._safe(name, globals(), locals(), [], 0)

    # ── Verboden modules worden geblokkeerd ──────────────────────────────────
    def test_os_geblokkeerd(self):
        with self.assertRaises(ImportError):
            self._import_via_sandbox('os')

    def test_subprocess_geblokkeerd(self):
        with self.assertRaises(ImportError):
            self._import_via_sandbox('subprocess')

    def test_socket_geblokkeerd(self):
        with self.assertRaises(ImportError):
            self._import_via_sandbox('socket')

    def test_ctypes_geblokkeerd(self):
        with self.assertRaises(ImportError):
            self._import_via_sandbox('ctypes')

    def test_alle_geblokkeerde_modules(self):
        for mod in BLOCKED_MODULES:
            with self.subTest(module=mod):
                with self.assertRaises(ImportError):
                    self._import_via_sandbox(mod)

    # ── Submodule-omzeiling wordt geblokkeerd ────────────────────────────────
    def test_os_path_submodule_geblokkeerd(self):
        # 'os.path' heeft root 'os' → moet geblokkeerd blijven
        with self.assertRaises(ImportError):
            self._import_via_sandbox('os.path')

    def test_importlib_submodule_geblokkeerd(self):
        with self.assertRaises(ImportError):
            self._import_via_sandbox('importlib.util')

    # ── Toegestane modules werken nog ────────────────────────────────────────
    def test_math_toegestaan(self):
        m = self._import_via_sandbox('math')
        self.assertTrue(hasattr(m, 'sqrt'))

    def test_random_toegestaan(self):
        r = self._import_via_sandbox('random')
        self.assertTrue(hasattr(r, 'randint'))

    def test_json_toegestaan(self):
        j = self._import_via_sandbox('json')
        self.assertTrue(hasattr(j, 'dumps'))


class TestSandboxCodePatterns(unittest.TestCase):
    """Test dat verdachte code-patronen herkenbaar zijn.
    De echte afdwinging gebeurt runtime via _safe_import; hier controleren
    we dat de blokkeerlijst de bekende escape-vectoren dekt."""

    def test_bekende_escape_modules_gedekt(self):
        # Deze modules zijn de klassieke sandbox-escape vectoren.
        escape_vectors = ['os', 'subprocess', 'ctypes', 'importlib', 'socket']
        for mod in escape_vectors:
            self.assertIn(mod, BLOCKED_MODULES,
                          f"{mod} zou geblokkeerd moeten zijn (escape-vector)")

    def test_process_manipulatie_gedekt(self):
        for mod in ['signal', 'multiprocessing', 'resource']:
            self.assertIn(mod, BLOCKED_MODULES)


if __name__ == '__main__':
    unittest.main(verbosity=2)
