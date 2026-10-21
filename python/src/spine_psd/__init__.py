"""PSD to Spine skeleton generation sidecar.

Called by the TypeScript execution layer over stdin/stdout JSON; see
`cli.py` for the contract.
"""

from .pipeline import PipelineResult, run_pipeline

__all__ = ["PipelineResult", "run_pipeline"]
__version__ = "0.1.0"
