#!/usr/bin/env python3
"""Focused release tests; dotted/hyphenated filenames require explicit loading."""
import importlib.util
from pathlib import Path
import unittest

suite = unittest.TestSuite()
for index, path in enumerate(sorted(Path(__file__).parent.glob('release-*.test.py'))):
    spec = importlib.util.spec_from_file_location('studio_release_test_' + str(index), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
if suite.countTestCases() == 0:
    raise SystemExit('No release tests loaded')
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
