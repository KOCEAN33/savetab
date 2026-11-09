<script lang="ts" generics="T extends string | boolean">
  let {
    legend,
    value,
    options,
    onchange,
  }: {
    legend: string;
    value: T;
    options: [T, string][];
    onchange: (v: T) => void;
  } = $props();
</script>

<fieldset class="choice">
  <legend>{legend}</legend>
  {#each options as [v, label] (String(v))}
    <label>
      <input type="radio" checked={value === v} onchange={() => onchange(v)} />
      {label}
    </label>
  {/each}
</fieldset>
