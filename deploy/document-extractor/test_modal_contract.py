import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("modal_contract.py")
SPEC = importlib.util.spec_from_file_location("modal_contract", MODULE_PATH)
modal_contract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(modal_contract)


class ModalContractTests(unittest.TestCase):
    def test_source_must_match_the_claimed_sha256(self):
        payload = b"immutable pdf bytes"
        claimed = "fd40530b15a508f35c60a90d7455725ffd97f0894bcb9c8f91a433fe05400f1a"

        self.assertEqual(modal_contract.verify_source(payload, claimed, 1024), claimed)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            modal_contract.verify_source(payload, "0" * 64, 1024)

    def test_source_size_is_bounded_before_extraction(self):
        with self.assertRaisesRegex(ValueError, "size limit"):
            modal_contract.verify_source(b"five!", "0" * 64, 4)

    def test_diagnostic_redacts_the_staging_path_and_is_bounded(self):
        diagnostic = modal_contract.safe_diagnostic(
            "/tmp/vokoo-docling-private/source.pdf: CUDA failed\n" + "x" * 5000,
            "/tmp/vokoo-docling-private",
        )

        self.assertNotIn("/tmp/vokoo-docling-private", diagnostic)
        self.assertIn("[staged]/source.pdf: CUDA failed", diagnostic)
        self.assertLessEqual(len(diagnostic.encode("utf-8")), 2048)


if __name__ == "__main__":
    unittest.main()
