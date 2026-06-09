import os
import json
from pathlib import Path
from datetime import datetime
from .base import BaseParser

class CodexParser(BaseParser):
    def get_framework_name(self) -> str:
        return "Codex"

    def _parse_timestamp(self, ts_str):
        if not ts_str:
            return None
        try:
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            return None

    def _to_nonneg_int(self, value) -> int:
        try:
            if value is None:
                return 0
            return max(0, int(value))
        except (TypeError, ValueError):
            try:
                return max(0, int(float(value)))
            except (TypeError, ValueError):
                return 0

    def _parse_usage(self, usage_obj: dict | None) -> dict | None:
        if not isinstance(usage_obj, dict):
            return None

        raw_input = self._to_nonneg_int(usage_obj.get("input_tokens", 0))
        cache_read = self._to_nonneg_int(usage_obj.get("cached_input_tokens", 0))
        output = self._to_nonneg_int(usage_obj.get("output_tokens", 0))
        reasoning = self._to_nonneg_int(usage_obj.get("reasoning_output_tokens", 0))
        reported_total = self._to_nonneg_int(usage_obj.get("total_tokens", 0))

        # Codex input_tokens includes cached_input_tokens.
        # Store net input to avoid double counting.
        input_net = max(0, raw_input - cache_read)
        computed_total = input_net + output + cache_read
        total = reported_total or computed_total

        return {
            "input_tokens": input_net,
            "output_tokens": output,
            "reasoning_tokens": reasoning,
            "cache_read_tokens": cache_read,
            "total_tokens": total,
        }

    def _subtract_usage(self, current: dict, previous: dict) -> dict:
        return {
            "input_tokens": max(0, current["input_tokens"] - previous["input_tokens"]),
            "output_tokens": max(0, current["output_tokens"] - previous["output_tokens"]),
            "reasoning_tokens": max(0, current["reasoning_tokens"] - previous["reasoning_tokens"]),
            "cache_read_tokens": max(0, current["cache_read_tokens"] - previous["cache_read_tokens"]),
            "total_tokens": max(0, current["total_tokens"] - previous["total_tokens"]),
        }

    def _add_usage(self, left: dict, right: dict) -> dict:
        return {
            "input_tokens": left["input_tokens"] + right["input_tokens"],
            "output_tokens": left["output_tokens"] + right["output_tokens"],
            "reasoning_tokens": left["reasoning_tokens"] + right["reasoning_tokens"],
            "cache_read_tokens": left["cache_read_tokens"] + right["cache_read_tokens"],
            "total_tokens": left["total_tokens"] + right["total_tokens"],
        }

    def _parse_session_file(self, filepath: Path, config_manager) -> dict | None:
        session_id = filepath.stem
        cwd = ""
        model = "unknown"
        
        input_tokens = 0
        output_tokens = 0
        cache_read_tokens = 0
        cache_write_tokens = 0  # Codex doesn't typically have cache creation, but keep it for config mapping compatibility
        
        models_breakdown = {}
        timestamps = []
        previous_total_usage = None

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
                    payload = data.get("payload", {})
                    if not isinstance(payload, dict):
                        payload = {}
                        
                    ts = self._parse_timestamp(data.get("timestamp"))
                    if ts:
                        timestamps.append(ts)

                    if record_type == "session_meta":
                        if not cwd:
                            cwd = payload.get("cwd", "")
                            
                    elif record_type == "turn_context":
                        if payload.get("model"):
                            model = payload["model"]
                            
                    elif record_type == "event_msg":
                        if payload.get("type") != "token_count":
                            continue
                            
                        info = payload.get("info")
                        if not isinstance(info, dict):
                            continue
                            
                        last_usage = self._parse_usage(info.get("last_token_usage"))
                        total_usage = self._parse_usage(info.get("total_token_usage"))
                        
                        delta_usage = None
                        latest_total_usage = None
                        
                        if last_usage:
                            delta_usage = last_usage
                            latest_total_usage = total_usage
                        elif total_usage:
                            delta_usage = (
                                self._subtract_usage(total_usage, previous_total_usage)
                                if previous_total_usage
                                else total_usage
                            )
                            latest_total_usage = total_usage
                            
                        if not delta_usage:
                            continue
                            
                        has_usage_signal = (
                            delta_usage["input_tokens"] > 0
                            or delta_usage["output_tokens"] > 0
                            or delta_usage["cache_read_tokens"] > 0
                            or delta_usage["total_tokens"] > 0
                        )
                        if not has_usage_signal:
                            if latest_total_usage:
                                previous_total_usage = latest_total_usage
                            continue
                            
                        in_tok = delta_usage["input_tokens"]
                        out_tok = delta_usage["output_tokens"]
                        cr_tok = delta_usage["cache_read_tokens"]
                        cw_tok = 0  # Codex doesn't typically output cache creation
                        
                        input_tokens += in_tok
                        output_tokens += out_tok
                        cache_read_tokens += cr_tok
                        
                        current_model = model or "unknown"
                        if current_model not in models_breakdown:
                            models_breakdown[current_model] = {
                                "input_tokens": 0,
                                "output_tokens": 0,
                                "cache_read_tokens": 0,
                                "cache_write_tokens": 0,
                                "total_tokens": 0,
                                "cost": 0.0
                            }
                            
                        m_stats = models_breakdown[current_model]
                        m_stats["input_tokens"] += in_tok
                        m_stats["output_tokens"] += out_tok
                        m_stats["cache_read_tokens"] += cr_tok
                        m_stats["total_tokens"] += (in_tok + out_tok + cr_tok)
                        
                        # Update running usage history
                        if latest_total_usage:
                            previous_total_usage = latest_total_usage
                        elif previous_total_usage:
                            previous_total_usage = self._add_usage(previous_total_usage, delta_usage)
                        else:
                            previous_total_usage = delta_usage
                            
        except Exception as e:
            print(f"Error parsing Codex session {filepath}: {e}")
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
        sessions_dir = Path("E:\\codex\\.codex\\sessions")
        if not sessions_dir.exists():
            sessions_dir = Path.home() / ".codex" / "sessions"
            
        sessions = []
        if not sessions_dir.exists():
            return sessions

        # Codex files are in a year/month/day structure. Search recursively for all .jsonl files.
        for filepath in sessions_dir.rglob("*.jsonl"):
            session_data = self._parse_session_file(filepath, config_manager)
            if session_data:
                sessions.append(session_data)
                
        return sessions
