from abc import ABC, abstractmethod

class BaseParser(ABC):
    @abstractmethod
    def get_framework_name(self) -> str:
        """Return the user-friendly name of the framework."""
        pass

    @abstractmethod
    def parse_sessions(self, config_manager) -> list[dict]:
        """Parse sessions and return a list of parsed session dicts.
        
        Each session dict should have:
          - id: str
          - framework: str
          - file: str
          - path: str
          - cwd: str
          - start: str (ISO 8601 format or empty)
          - end: str (ISO 8601 format or empty)
          - input_tokens: int
          - output_tokens: int
          - cache_read_tokens: int
          - cache_write_tokens: int
          - total_tokens: int
          - models: dict { model_name: {input_tokens: int, output_tokens: int, cache_read_tokens: int, cache_write_tokens: int, total_tokens: int, cost: float} }
          - cost: float
        """
        pass
