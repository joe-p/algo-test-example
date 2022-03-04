#!/usr/bin/env python3
from pyteal import *
import os

def approval():
    return If(
        Txn.application_id() == Int(0), 
        Approve(), 
        Seq(
            App.globalPut(Bytes("Year"), Int(1970) + Global.latest_timestamp()/Int(60*60*24*365)),
            App.globalPut(Bytes("Caller"), Txn.sender()),
            App.globalPut(Bytes("Message"), Bytes("Hello World!")),
            Approve()
        )
    )

def clear():
    return Approve()

if __name__ == "__main__":
    if os.path.exists("approval.teal"):
        os.remove("approval.teal") 
    
    if os.path.exists("approval.teal"):
        os.remove("clear.teal") 

    compiled_approval = compileTeal(approval(), mode=Mode.Application, version=5)

    with open("approval.teal", "w") as f:
        f.write(compiled_approval)

    compiled_clear = compileTeal(clear(), mode=Mode.Application, version=5)

    with open("clear.teal", "w") as f:
        f.write(compiled_clear)
