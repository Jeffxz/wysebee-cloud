"""An extension built for another version of the interface (tests/test_extensions.py)."""

from apps.cloud.extensions import Extension


def register(settings) -> Extension:
    return Extension("tests.old_extension", 0)
