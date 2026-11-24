"""Model-written code must not inherit API keys. Uses a dummy key only."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from researchclaw.config import SandboxConfig
from researchclaw.utils.safe_env import clean_env

DUMMY = "sk-or-v1-dummy0000000000000000000000000000"
NAMES = (
    "RESEARCHCLAW_API_KEY", "RESEARCHCLAW_IMAGE_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
    "EXA_API_KEY", "TAVILY_API_KEY", "HF_TOKEN", "GITHUB_TOKEN", "MY_SECRET", "DB_PASSWORD",
)
DUMP = "import os\nfor k, v in os.environ.items():\n    print(f'{k}={v}')\n"


@pytest.fixture(autouse=True)
def _dummy_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for n in NAMES:
        monkeypatch.setenv(n, DUMMY)
    monkeypatch.setenv("INNOCENT_NAME", DUMMY)           # same key, harmless name
    monkeypatch.setenv("SOME_URL", f"https://x/?k={DUMMY}")  # key inside another value
    monkeypatch.setenv("KEYBOARD_LAYOUT", "us")
    monkeypatch.setenv("TOKENIZERS_PARALLELISM", "false")


def _assert_clean(text: str) -> None:
    assert text.strip(), "the code under test did not run"
    assert "PATH=" in text
    assert DUMMY not in text
    for n in NAMES:
        assert f"{n}=" not in text


def test_clean_env_rules() -> None:
    env = clean_env({"X": "1"})
    assert not any(DUMMY in v for v in env.values())
    assert env["X"] == "1"
    assert env["KEYBOARD_LAYOUT"] == "us" and env["TOKENIZERS_PARALLELISM"] == "false"
    assert env["PATH"] == os.environ["PATH"] and env["HOME"] == os.environ["HOME"]
    kept = clean_env(keep=("OPENAI_API_KEY",))
    assert kept["OPENAI_API_KEY"] == DUMMY and "RESEARCHCLAW_API_KEY" not in kept


def test_dummy_key_is_really_inherited_without_stripping() -> None:
    out = subprocess.run([sys.executable, "-c", DUMP], capture_output=True, text=True).stdout
    assert DUMMY in out  # otherwise the tests below would prove nothing


def test_sandbox_script_and_project(tmp_path: Path) -> None:
    from researchclaw.experiment.sandbox import ExperimentSandbox
    sb = ExperimentSandbox(SandboxConfig(python_path=sys.executable), tmp_path / "w")
    _assert_clean(sb.run(DUMP, timeout_sec=60).stdout)
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "main.py").write_text(DUMP)
    _assert_clean(sb.run_project(proj, timeout_sec=60).stdout)


def test_agent_bash_tool(tmp_path: Path) -> None:
    from researchclaw.pipeline.claw_engine.tools.executor import ToolExecutor
    out, is_error = ToolExecutor(tmp_path, python_path=sys.executable).execute("bash", {"command": "env"})
    assert not is_error
    _assert_clean(out)


def test_figure_script(tmp_path: Path) -> None:
    from researchclaw.agents.figure_agent.renderer import RendererAgent
    script = tmp_path / "plot.py"
    script.write_text("import os\nopen('env.txt','w').write('\\n'.join(f'{k}={v}' for k, v in os.environ.items()))\n")
    RendererAgent(None, python_path=sys.executable, use_docker=False)._execute_local(
        script_path=script, output_dir=tmp_path)
    _assert_clean((tmp_path / "env.txt").read_text())


def test_git_hooks(tmp_path: Path) -> None:
    from researchclaw.experiment.git_manager import ExperimentGitManager
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    hook = tmp_path / ".git" / "hooks" / "pre-commit"
    hook.parent.mkdir(exist_ok=True)
    hook.write_text(f"#!/bin/sh\nenv > '{tmp_path}/env.txt'\n")
    hook.chmod(hook.stat().st_mode | stat.S_IEXEC)
    mgr = ExperimentGitManager(tmp_path)
    mgr._run_git(["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "--allow-empty", "-m", "t"])
    _assert_clean((tmp_path / "env.txt").read_text())


@pytest.mark.parametrize("tool", ["pdflatex", "bibtex"])
def test_latex(tool: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from researchclaw.templates import compiler
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for t in ("pdflatex", "bibtex"):
        f = bindir / t
        f.write_text(f"#!/bin/sh\nenv > '{tmp_path}/{t}.txt'\n")
        f.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    (tmp_path / "a.tex").write_text("x")
    if tool == "pdflatex":
        compiler.compile_latex(tmp_path / "a.tex", max_attempts=1, timeout=20)
    else:
        compiler._run_bibtex(tmp_path, "a")
    _assert_clean((tmp_path / f"{tool}.txt").read_text())


def test_external_agents_keep_only_their_own_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from researchclaw.pipeline import opencode_bridge, openhands_bridge
    seen: dict = {}

    def fake_run(cmd, **kw):  # noqa: ANN001, ANN003
        seen.update(kw["env"])
        return subprocess.CompletedProcess(cmd, 0, "", "")
    br = opencode_bridge.OpenCodeBridge(api_key_env="RESEARCHCLAW_API_KEY")
    monkeypatch.setattr(opencode_bridge.subprocess, "run", fake_run)
    br._invoke_opencode(tmp_path, "hi")
    assert "EXA_API_KEY" not in seen and "HF_TOKEN" not in seen and "GITHUB_TOKEN" not in seen
    assert "clean_env" in Path(openhands_bridge.__file__).read_text()


def test_no_generated_code_path_uses_the_raw_environment() -> None:
    root = Path(__file__).resolve().parents[1] / "researchclaw"
    for rel in ("experiment", "pipeline", "agents", "templates"):
        for f in (root / rel).rglob("*.py"):
            text = f.read_text(encoding="utf-8")
            assert "os.environ.copy()" not in text, f
            assert "**os.environ" not in text, f
