# Interview phrases — spoken English

Use one or two sentences, then point to the relevant code or demonstrate the behavior.

| Topic                  | A natural explanation                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why AG Grid            | “I chose AG Grid because this interface needs more than a basic table. It gives us editing, virtualization and clear APIs for updating data.”              |
| Client-Side Row Model  | “The current device fleet fits in browser memory. The client-side model can sort and filter the complete dataset without another request.”                 |
| Infinite Row Model     | “Historical data is loaded in blocks as the user scrolls. The grid asks the datasource for a range and passes the current filter and sort models.”         |
| Historical volume      | “I would not load the whole history into the browser. That increases memory use and delays the first useful result.”                                       |
| High-frequency updates | “Each tick creates only the changed rows. I submit them through async transactions instead of replacing the entire row array.”                             |
| Stable IDs             | “A device ID stays the same when the row moves. That lets the grid update the right row and preserve its state.”                                           |
| Batching               | “Batching lets the grid process several updates together. We accept a short delay to reduce repeated sorting, filtering and rendering work.”               |
| Sorting and filtering  | “The filter is applied before we slice a page. Otherwise the result would only be correct within the loaded block.”                                        |
| Display values         | “The formatter changes how a value looks. The underlying value remains numeric, so sorting still works correctly.”                                         |
| Editing                | “The editor collects input, the parser converts it, and the validator checks the domain rules. The setter decides whether the row can change.”             |
| Cross-field validation | “The warning threshold must stay below the critical threshold. I validate the whole candidate device because a single field does not have enough context.” |
| Save strategy          | “I use a pessimistic save. The saved baseline changes only after success, and a failed request leaves the draft available.”                                |
| Dirty state            | “I compare the draft with a separate saved baseline. Revert restores that baseline; it does not depend on the grid's undo history.”                        |
| Mock datasource        | “This mock uses the same kind of asynchronous contract as a backend. It simulates latency and errors, but query processing still happens locally.”         |
| Parallel requests      | “Two blocks can load at the same time. I invalidate an old query, not every request that started before another request.”                                  |
| Cancellation           | “Cancellation saves unnecessary work. I also check the query generation before applying a response, because an old response may arrive late.”              |
| Community / Enterprise | “The baseline uses Community only. Native grouping, pivot and spreadsheet-style range clipboard are Enterprise features.”                                  |
| Analytics scope        | “These are summaries computed by the application. I am not presenting them as AG Grid's native grouping or pivot.”                                         |
| Virtualization         | “Only a small part of the dataset is rendered in the DOM. That reduces rendering cost, but it does not eliminate the cost of processing the data.”         |
| React references       | “I keep column definitions and object props stable. Otherwise an unrelated React render can trigger unnecessary grid work.”                                |
| Grid State             | “I persist view preferences, such as column order and filters. I do not store the entire dataset in localStorage.”                                         |
| Performance trade-off  | “The mock builds a compact index and yields during processing. That keeps the example simple, but a real backend should own this work.”                    |
| Backend boundary       | “I would move historical filtering, sorting and aggregation to the backend. The browser would send a validated query and receive a bounded result.”        |
| Timestream pagination  | “I would design around time windows and continuation tokens. Arbitrary offsets and exact counts may be expensive for a time-series query.”                 |
| Production reliability | “For a real stream, I would add reconnect logic, deduplication and backpressure. Those concerns are outside this local demo.”                              |
| Measurement honesty    | “These numbers are local diagnostics. I would measure the target workload before making an FPS or latency commitment.”                                     |

## A 60-second walkthrough

“This is a local IoT console with four focused views. Live Telemetry uses the client-side model and async transactions to update only changed devices. Historical Logs uses the Infinite Row Model and an asynchronous datasource that loads blocks. Configuration separates parsing, validation and persistence, with a saved baseline for safe revert. Analytics displays summaries from a fixed sample using Community components. I also persist view state and test the query and editing rules separately from the grid. With a real backend, historical processing and durable saves would move to the server.”

## Clarify a requirement professionally

- “Does the user need a flat history, or do they also need server-side grouping?”
- “Should a draft survive a page reload, or only navigation within this session?”
- “What is the expected event rate, and how much display delay is acceptable?”
- “Do we need an exact total count, or is loading more results sufficient?”
- “Is Enterprise licensing available for the features we are discussing?”
