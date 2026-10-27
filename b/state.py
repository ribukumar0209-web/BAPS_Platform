import time

class ProcessState:
    def __init__(self):
        self.is_paused = False
        self.is_aborted = False

    def reset(self):
        self.is_paused = False
        self.is_aborted = False

    def check(self):
        if self.is_aborted:
            raise Exception("PROCESS_ABORTED")
        while self.is_paused:
            time.sleep(0.5)
            if self.is_aborted:
                raise Exception("PROCESS_ABORTED")

global_state = ProcessState()
