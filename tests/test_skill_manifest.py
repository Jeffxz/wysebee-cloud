"""A skill's SKILL.md (apps/cloud/skill_manifest.py), read as Wysebee Agent for Mac reads it."""

import pytest

from apps.cloud import skill_manifest as m


def test_the_front_matter_and_instructions_are_read() -> None:
    source = (
        "﻿---\r\n# a comment\r\nname: forecast\r\ndescription: >\r\n  Weather,\r\n  today.\r\nmetadata:\r\n  team: ops\r\n"
        "scripts:\r\n  - name: run\r\n    command: \"python3 run.py\"\r\n    description: |\r\n      Fetches\r\n      it.\r\n"
        "  -\r\n    name: other\r\n    command: './x.sh'\r\nlater: 'it''s'\r\n---\r\n\r\nRead notes.md first.\r\n"
    )
    got = m.parse(source, "folder")
    assert (got.name, got.description, got.body) == ("forecast", "Weather, today.", "Read notes.md first.")
    assert got.scripts == [{"name": "run", "command": "python3 run.py", "description": "Fetches\nit."}, {"name": "other", "command": "./x.sh", "description": ""}]
    # No name in it: the folder's.
    assert m.parse("---\ndescription: D.\n---\nB", "plain").name == "plain"


@pytest.mark.parametrize(("source", "said"), [
    ("no front matter", "starts with a line '---'"),
    ("---\nname: x\n", "starts with a line '---'"),
    ("---\njust words\n---\n", "The line 'just words' of SKILL.md could not be read."),
    ('---\nname: "unclosed\n---\n', "could not be read"),
    ("---\nname: Bad\ndescription: D.\n---\n", "a skill's name starts"),
    ("---\nname: ok\n---\n", "describe what it is for"),
    ("---\nname: ok\ndescription: " + "x" * 1025 + "\n---\n", "describe what it is for"),
    ("---\nname: ok\ndescription: D.\n---\n" + "x" * 100_001, "the instructions are at most"),
    ("---\nname: ok\ndescription: D.\nscripts:\n    command: x\n---\n", "could not be read"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - nonsense\n---\n", "could not be read"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - name: Bad\n    command: x\n---\n", "Script 1: its name"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - name: run\n---\n", "give the command"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - name: run\n    command: \"a 'b\"\n---\n", "a quote in its command is not closed"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - name: run\n    command: x\n    description: " + "y" * 1001 + "\n---\n", "the description is at most"),
    ("---\nname: ok\ndescription: D.\nscripts:\n  - name: run\n    command: x\n  - name: run\n    command: y\n---\n", "Two scripts are named 'run'."),
    ("---\nname: ok\ndescription: D.\nscripts:\n" + "".join(f"  - name: s{i}\n    command: x\n" for i in range(21)) + "---\n", "at most 20 scripts"),
])
def test_what_cannot_be_read_says_why(source: str, said: str) -> None:
    with pytest.raises(m.Unreadable) as e:
        m.parse(source, "folder")
    assert said in str(e.value)


def test_the_name_is_set_in_place_or_added() -> None:
    assert m.with_name("---\nname: old\ndescription: D.\n  name: nested\n---\nB", "new") == "---\nname: new\ndescription: D.\n  name: nested\n---\nB"
    assert m.with_name("---\ndescription: D.\n---\nB", "new") == "---\nname: new\ndescription: D.\n---\nB"
    with pytest.raises(m.Unreadable):
        m.with_name("plain text", "new")


def test_a_new_skill_md_reads_back() -> None:
    text = m.render("forecast", 'Say "hi".', "\n  Do it.  \n")
    assert text == '---\nname: forecast\ndescription: "Say \\"hi\\"."\n---\n\nDo it.\n'
    assert m.parse(text, "x").description == 'Say "hi".'


def test_a_command_is_split_into_words() -> None:
    assert m.split_command("python3  'my script.py' \"a b\" '' x") == ["python3", "my script.py", "a b", "", "x"]
    assert m.split_command("say 'unclosed") is None
    assert m.split_command("") == []


@pytest.mark.parametrize(("path", "secret"), [
    (".env", True), ("conf/.env.local", True), ("key.pem", True), ("a/id_rsa", True), ("id_rsa.pub", False),
    (".npmrc", True), ("my_token.txt", True), ("scripts/run.py", False), ("README", False),
])
def test_files_that_look_like_secrets(path: str, secret: bool) -> None:
    assert m.is_secret(path) is secret
