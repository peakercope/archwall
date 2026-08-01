<script setup lang="ts">
// The whole point of this fixture: a real import, inside a file the CLI scanner cannot lex.
// Before `unscannable-files` existed this module, this edge, and any violation it caused were
// absent from the graph with no warning of any kind — a green CI run over unread code.
import { helper } from "../helper";
</script>

<template>
  <div>{{ helper() }}</div>
</template>
