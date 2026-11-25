# Context Usage Plugin

Core domain vocabulary for the Antigravity Context Usage monitoring plugin, strictly operating within the Official Extension Boundary.

## Language

**Context Usage**:
The total token occupancy of the model's context window after the most recent model invocation in a conversation, calculated as uncached input tokens plus cached prompt tokens plus output tokens.
_Avoid_: Total tokens, session cost, cumulative usage

**Cumulative Usage**:
The sum of all input, cache-read, and output tokens consumed across every model invocation since the start of a conversation.
_Avoid_: Context usage, window usage

**Context Window Limit**:
The maximum token capacity supported by a given model for a single invocation, used as the denominator to compute context utilization percentage.
_Avoid_: Quota, rate limit, budget

**Official Extension Boundary**:
The strict compliance constraint restricting the plugin exclusively to documented Antigravity extension surfaces, lifecycle contracts, and data sources, excluding private RPCs, host DOM injection, and undocumented internal state files.
_Avoid_: Hack, workaround, private API

**Cache Hit Rate**:
The ratio of cached prompt tokens to total input prompt tokens (cached plus uncached) on a model invocation, expressed as a percentage.
_Avoid_: Cache efficiency, hit ratio
