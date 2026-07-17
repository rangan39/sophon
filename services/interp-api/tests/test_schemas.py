import unittest

from pydantic import ValidationError

from sophon_interp.schemas import RunRequest


class RunRequestTests(unittest.TestCase):
    def test_accepts_a_valid_request(self) -> None:
        request = RunRequest(prompt="The signal is")

        self.assertEqual(request.model, "gpt2-small")
        self.assertEqual(request.maxTokens, 64)

    def test_rejects_whitespace_only_prompts(self) -> None:
        with self.assertRaises(ValidationError):
            RunRequest(prompt="   \n")

    def test_rejects_unknown_models_and_fields(self) -> None:
        with self.assertRaises(ValidationError):
            RunRequest.model_validate({"prompt": "hello", "model": "untrusted-model"})
        with self.assertRaises(ValidationError):
            RunRequest.model_validate({"prompt": "hello", "unexpected": True})


if __name__ == "__main__":
    unittest.main()
