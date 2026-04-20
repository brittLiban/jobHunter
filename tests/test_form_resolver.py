import unittest

from llm.form_resolver import (
    FormResolutionResult,
    ResolvedFormQuestion,
    _enforce_grounding,
    _grounding_catalog,
)


class FormResolverGroundingTests(unittest.TestCase):
    def setUp(self) -> None:
        known_profile_values = {
            "open_to_relocation": "No",
            "legally_eligible_to_begin_immediately": "Yes",
            "custom_question_answers": [
                {
                    "label": "Are you familiar with Twitch?",
                    "value": "Yes",
                    "kind": "select",
                }
            ],
        }
        generated_materials = {
            "candidate_profile_summary": (
                "I am a software developer who enjoys building reliable backend systems "
                "and collaborating across teams."
            )
        }
        self.catalog = _grounding_catalog(known_profile_values, generated_materials)

    def _ground(self, label: str, answer: str, answer_source: str = "profile") -> ResolvedFormQuestion:
        parsed = FormResolutionResult(
            resolutions=[
                ResolvedFormQuestion(
                    label=label,
                    answer=answer,
                    safe_to_autofill=True,
                    answer_source=answer_source,
                    reason="",
                )
            ]
        )
        grounded = _enforce_grounding(parsed, self.catalog)
        return grounded.resolutions[0]

    def test_custom_answer_accepts_matching_label(self) -> None:
        grounded = self._ground("Are you familiar with Twitch?", "Yes", "custom_answer")
        self.assertTrue(grounded.safe_to_autofill)
        self.assertEqual("custom_answer", grounded.answer_source)
        self.assertEqual("Yes", grounded.answer)

    def test_profile_answer_requires_matching_label(self) -> None:
        grounded = self._ground("Are you open to relocation?", "No")
        self.assertTrue(grounded.safe_to_autofill)
        self.assertEqual("profile", grounded.answer_source)
        self.assertEqual("No", grounded.answer)

    def test_unrelated_yes_no_answer_is_rejected(self) -> None:
        grounded = self._ground(
            "Are you open to relocation?",
            "Yes",
        )
        self.assertFalse(grounded.safe_to_autofill)
        self.assertIsNone(grounded.answer)
        self.assertEqual("unknown", grounded.answer_source)

    def test_generated_answer_allowed_for_open_text_prompt(self) -> None:
        grounded = self._ground(
            "Why do you want to work here?",
            "I am a software developer who enjoys building reliable backend systems",
            "generated_material",
        )
        self.assertTrue(grounded.safe_to_autofill)
        self.assertEqual("generated_material", grounded.answer_source)

    def test_generated_answer_rejected_for_non_open_text_prompt(self) -> None:
        grounded = self._ground(
            "If offered employment by Amazon, would you be legally eligible to begin employment immediately?",
            "I am a software developer who enjoys building reliable backend systems",
            "generated_material",
        )
        self.assertFalse(grounded.safe_to_autofill)
        self.assertIsNone(grounded.answer)
        self.assertEqual("unknown", grounded.answer_source)


if __name__ == "__main__":
    unittest.main()
