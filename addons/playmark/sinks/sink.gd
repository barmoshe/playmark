extends RefCounted
## Where a finished mark goes. The file sink is the only one today; an HTTP sink
## (iPhone on the same network, the web build) and a live Claude channel come next.
##
## A mark arrives as `data` (the mark.json dictionary) and `images` (file name -> Image).
## Return a human-readable location ("" on failure).


func send(_data: Dictionary, _images: Dictionary, _log_text: String) -> String:
	push_error("Playmark: sink.send() not implemented")
	return ""
