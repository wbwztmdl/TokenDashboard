import os
import json
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).parent / "config.json"
DEFAULT_EXCLUDE_PATHS = [str(Path.home() / "Documents" / "Codex" / "*")]

class ConfigManager:
    def __init__(self, config_path=DEFAULT_CONFIG_PATH):
        self.config_path = Path(config_path)
        self.config = self._load()

    def _load(self):
        if not self.config_path.exists():
            return {
                "exclude_paths": list(DEFAULT_EXCLUDE_PATHS),
                "lang": "zh-CN",
                "models": {}
            }
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                if "exclude_paths" not in config:
                    config["exclude_paths"] = list(DEFAULT_EXCLUDE_PATHS)
                if "lang" not in config:
                    config["lang"] = "zh-CN"
                if "models" not in config:
                    config["models"] = {}
                return config
        except Exception as e:
            print(f"Error loading config: {e}")
            return {
                "exclude_paths": list(DEFAULT_EXCLUDE_PATHS),
                "lang": "zh-CN",
                "models": {}
            }

    def save(self, config_data):
        try:
            self.config = {
                "exclude_paths": list(config_data.get("exclude_paths", [])),
                "lang": str(config_data.get("lang", "zh-CN")),
                "models": {}
            }
            models_data = config_data.get("models", {})
            for model_name, pricing in models_data.items():
                self.config["models"][model_name] = {
                    "input": float(pricing.get("input", 0.0)),
                    "output": float(pricing.get("output", 0.0)),
                    "cacheRead": float(pricing.get("cacheRead", 0.0)),
                    "cacheCreate": float(pricing.get("cacheCreate", 0.0)),
                    "multiplier": float(pricing.get("multiplier", 1.0))
                }
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Error saving config: {e}")
            return False

    def get_merged_config(self, discovered_models):
        """Returns the config, merging any discovered models with price and multiplier defaults."""
        merged = {
            "exclude_paths": list(self.config.get("exclude_paths", DEFAULT_EXCLUDE_PATHS)),
            "lang": str(self.config.get("lang", "zh-CN")),
            "models": {}
        }
        
        # First copy existing model configurations
        for model_name, pricing in self.config.get("models", {}).items():
            merged["models"][model_name] = {
                "input": float(pricing.get("input", 0.0)),
                "output": float(pricing.get("output", 0.0)),
                "cacheRead": float(pricing.get("cacheRead", 0.0)),
                "cacheCreate": float(pricing.get("cacheCreate", 0.0)),
                "multiplier": float(pricing.get("multiplier", 1.0))
            }
            
        # Add new discovered models with 0.0 defaults and 1.0 multiplier
        for model_name in discovered_models:
            if model_name not in merged["models"]:
                merged["models"][model_name] = {
                    "input": 0.0,
                    "output": 0.0,
                    "cacheRead": 0.0,
                    "cacheCreate": 0.0,
                    "multiplier": 1.0
                }
                
        return merged

    def calculate_cost(self, model, input_tok, output_tok, cache_read_tok, cache_create_tok):
        """Calculate cost based on current model prices (per 1M tokens) and model-specific multiplier."""
        pricing = self.config.get("models", {}).get(model)
        
        if not pricing:
            return 0.0
            
        input_price = float(pricing.get("input", 0.0))
        output_price = float(pricing.get("output", 0.0))
        cache_read_price = float(pricing.get("cacheRead", 0.0))
        cache_create_price = float(pricing.get("cacheCreate", 0.0))
        multiplier = float(pricing.get("multiplier", 1.0))
        
        total_raw = (
            input_tok * input_price +
            output_tok * output_price +
            cache_read_tok * cache_read_price +
            cache_create_tok * cache_create_price
        )
        
        return (total_raw / 1_000_000.0) * multiplier
