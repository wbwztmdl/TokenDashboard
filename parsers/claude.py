import os
import json
from pathlib import Path
from datetime import datetime
from .base import BaseParser

class ClaudeParser(BaseParser):
    def get_framework_name(self) -> str:
        return "Claude Code"

    def _parse_timestamp(self, ts_str):
        if not ts_str:
            return None
        try:
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            return None

    def _parse_session_file(self, filepath: Path, config_manager) -> dict | None:
        """Parse a single Claude Code JSONL file."""
        session_id = filepath.stem
        cwd = ""
        
        # Accumulators
        input_tokens = 0
        output_tokens = 0
        cache_read_tokens = 0
        cache_write_tokens = 0
        
        models_breakdown = {}
        
        timestamps = []
        
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    
                    record_type = data.get("type")
                    
                    # Skip progress, snapshot, and summary to avoid double-counting
                    if record_type in ("progress", "file-history-snapshot", "summary"):
                        continue
                        
                    # Extract cwd
                    if not cwd and data.get("cwd"):
                        cwd = data["cwd"]
                        
                    ts = self._parse_timestamp(data.get("timestamp"))
                    if ts:
                        timestamps.append(ts)
                        
                    # Only parse "assistant" records for token usage to avoid user dialog spoofing
                    if record_type == "assistant":
                        msg = data.get("message", {})
                        usage = msg.get("usage", {})
                        model = msg.get("model", "")
                        
                        # Skip synthetic models/calls
                        if model == "<synthetic>" or not model:
                            continue
                            
                        if usage:
                            in_tok = int(usage.get("input_tokens", 0))
                            out_tok = int(usage.get("output_tokens", 0))
                            cr_tok = int(usage.get("cache_read_input_tokens", 0))
                            cw_tok = int(usage.get("cache_creation_input_tokens", 0))
                            
                            input_tokens += in_tok
                            output_tokens += out_tok
                            cache_read_tokens += cr_tok
                            cache_write_tokens += cw_tok
                            
                            # Update models breakdown
                            if model not in models_breakdown:
                                models_breakdown[model] = {
                                    "input_tokens": 0,
                                    "output_tokens": 0,
                                    "cache_read_tokens": 0,
                                    "cache_write_tokens": 0,
                                    "total_tokens": 0,
                                    "cost": 0.0
                                }
                            
                            m_stats = models_breakdown[model]
                            m_stats["input_tokens"] += in_tok
                            m_stats["output_tokens"] += out_tok
                            m_stats["cache_read_tokens"] += cr_tok
                            m_stats["cache_write_tokens"] += cw_tok
                            m_stats["total_tokens"] += (in_tok + out_tok + cr_tok + cw_tok)
                            
        except Exception as e:
            print(f"Error parsing Claude session {filepath}: {e}")
            return None

        # Determine start and end times
        start_str = ""
        end_str = ""
        if timestamps:
            start_str = min(timestamps).isoformat()
            end_str = max(timestamps).isoformat()
            
        total_tokens = input_tokens + output_tokens + cache_read_tokens + cache_write_tokens
        if total_tokens == 0 and not models_breakdown:
            return None

        # Compute costs using config_manager
        total_cost = 0.0
        for model_name, m_stats in models_breakdown.items():
            m_cost = config_manager.calculate_cost(
                model_name,
                m_stats["input_tokens"],
                m_stats["output_tokens"],
                m_stats["cache_read_tokens"],
                m_stats["cache_write_tokens"]
            )
            m_stats["cost"] = m_cost
            total_cost += m_cost

        return {
            "id": session_id,
            "framework": self.get_framework_name(),
            "file": filepath.name,
            "path": str(filepath.resolve()),
            "cwd": cwd or "unknown",
            "start": start_str,
            "end": end_str,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cache_write_tokens": cache_write_tokens,
            "total_tokens": total_tokens,
            "models": models_breakdown,
            "cost": total_cost
        }

    def parse_sessions(self, config_manager) -> list[dict]:
        projects_dir = Path("E:\\claudecode\\.claude\\projects")
        if not projects_dir.exists():
            projects_dir = Path.home() / ".claude" / "projects"
            
        sessions = []
        if not projects_dir.exists():
            return sessions

        for project_dir in projects_dir.iterdir():
            if not project_dir.is_dir() or project_dir.name.startswith("."):
                continue
                
            # Parse top-level session files in the project folder
            for filepath in project_dir.glob("*.jsonl"):
                session_data = self._parse_session_file(filepath, config_manager)
                if session_data:
                    sessions.append(session_data)
                    
                # Look for subagent sessions in a folder named after the session UUID
                subagent_dir = project_dir / filepath.stem
                if subagent_dir.exists() and subagent_dir.is_dir():
                    for sub_filepath in subagent_dir.rglob("*.jsonl"):
                        sub_session = self._parse_session_file(sub_filepath, config_manager)
                        if sub_session:
                            # Mark as subagent session and associate parent
                            sub_session["id"] = f"{session_data['id']}_sub_{sub_filepath.stem}" if session_data else sub_filepath.stem
                            sub_session["is_subagent"] = True
                            sub_session["parent_id"] = session_data["id"] if session_data else ""
                            sessions.append(sub_session)
                            
        return sessions
