# Baseline results recorded at M4 (before any BioFleet coordination)

10 seeds per row, makespan mean ± std in seconds; incomplete runs count the 600–3000 s timeout as makespan.

```
scenario             variant          done      makespan(s)   impr% coll maxStuck msg/r/s
S1/4r/none           baseline         10/10        92.3±9.0       —    0     11.2     5.2
S2/2r/none           baseline         10/10      203.4±62.9       —    0      6.8     5.1
S2/4r/none           baseline         10/10      214.4±26.6       —    0     35.9     5.1
S3/6r/none           baseline          5/10     536.8±265.2       —    0    779.6     5.1
S4/3r/none           baseline         10/10      939.7±36.5       —    0     10.8     5.2
S4/5r/none           baseline         10/10      630.7±38.5       —    0     15.4     5.2
S4/10r/none          baseline         10/10      489.8±47.3       —    0     27.1     5.2
S4/20r/none          baseline         10/10      363.8±90.7       —    0     40.8     5.3
S4/10r/F1-10         baseline         10/10      454.6±35.1       —    0     24.1     5.2
S4/10r/F1-30         baseline         10/10      471.6±55.0       —    0     27.2     5.3
S4/10r/F2            baseline         10/10      473.6±46.7       —    0     24.9     5.3
S4/10r/F3            baseline         10/10      478.3±37.4       —    0     24.9     5.2
S4/10r/F4            baseline         10/10      502.1±36.1       —    0     24.9     4.8
130 runs in 20.8 s → results/baseline-m4-*.csv
```
